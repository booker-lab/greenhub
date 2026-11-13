/**
 * 사진 업로드 대기열 실행기. 앱이 열려 있는 동안 기다리는 사진을 같은 키·같은 바이트로 다시 보낸다.
 * DOM·next-auth에 직접 기대지 않고 의존성을 받아(테스트는 가짜 fetch·메모리 저장소) 동작한다.
 *
 * - 보내는 요청은 사진 업로드 POST 하나(sendRoundDirectPhoto)뿐이다. PATCH DELIVERED는 보내지 않는다.
 * - 실행마다 세션을 새로 받아(getSession) 그 사용자의 항목만 보낸다. 다른 사용자 항목은 지운다.
 * - 같은 주문은 한 번에 하나만 보낸다: 탭 사이 잠금(Web Locks, 있으면) + 탭 안 표시 + 저장소의
 *   보내는 중 표시(leaseUntil). 사진 화면의 "지금 올리기"도 같은 함수·같은 잠금을 쓴다.
 * - 401이면 세션을 한 번 다시 받아 같은 사용자의 새 토큰으로 한 번만 다시 보낸다. 그래도 안 되면
 *   같은 사용자의 유효한 세션이 생길 때까지 멈춘다.
 */

import {
  claimPendingPhotoLease,
  decidePendingPhotoOutcome,
  deferPendingPhoto,
  expirePendingPhoto,
  failPendingPhoto,
  isPendingPhotoDue,
  isPendingPhotoLeaseActive,
  nextPendingPhotoWakeAt,
  type PendingPhotoEntry,
  type PendingPhotoSendResult,
  PENDING_PHOTO_LEASE_MS,
  partitionPendingPhotosByUser,
  pendingPhotoKey,
  pendingPhotoLockName,
  pendingPhotoManualReadyAt,
  releasePendingPhotoLease,
} from './pending-photo-policy';
import type { PendingPhotoStore } from './pending-photo-store';
import { type RoundDirectPhotoPost, sendRoundDirectPhoto } from './round-direct-send';

export interface PendingPhotoSession {
  userId: string;
  accessToken: string;
}

/** 판매자 ID 확인 결과(기사 주문 조회). */
export type PendingPhotoStoreIdRead =
  | { kind: 'ok'; storeId: string }
  // 주문이 보이지 않는다(404): 보낼 수 없다.
  | { kind: 'absent' }
  // 권한 없음(403).
  | { kind: 'authority' }
  // 로그인 확인 실패(401, 조회가 세션을 한 번 다시 받은 뒤에도).
  | { kind: 'unauthorized' }
  // 네트워크·시간 초과·5xx·형식 오류: 나중에 다시.
  | { kind: 'unknown' };

/** navigator.locks와 같은 모양(필요한 부분만). */
export interface PendingPhotoLockManager {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
}

export interface PendingPhotoRunnerDeps {
  store: PendingPhotoStore;
  /** 실행마다 새로 받는 세션. 없거나 쓸 수 없으면 null. */
  getSession: () => Promise<PendingPhotoSession | null>;
  post: RoundDirectPhotoPost;
  readStoreId: (orderId: string, token: string) => Promise<PendingPhotoStoreIdRead>;
  now: () => number;
  random: () => number;
  isOnline: () => boolean;
  locks: PendingPhotoLockManager | null;
  /** 완료(같은 키 재전송 ACK)로 항목을 지운 뒤 한 번 부른다. */
  onCompleted?: (entry: PendingPhotoEntry) => void;
  /** 멈춘 항목(failed)을 쓴 뒤 부른다. */
  onFailed?: (entry: PendingPhotoEntry) => void;
  /** 저장소 항목이 바뀐 뒤 부른다(화면 갱신). */
  onChanged?: () => void;
}

export type PendingPhotoRunResult =
  | 'done'
  | 'retry'
  | 'failed'
  | 'none'
  | 'no-session'
  | 'busy'
  | 'not-due'
  | 'offline'
  | 'paused';

export interface PendingPhotoRunner {
  /** 한 주문의 항목을 보낸다. manual이면 재시도 간격을 건너뛴다(불확실한 요청 뒤 30초는 지킨다). */
  runOrder(orderId: string, options?: { manual?: boolean }): Promise<PendingPhotoRunResult>;
  /**
   * 로그인한 사용자의 보낼 차례인 항목을 모두 보낸다. 다른 사용자 항목은 지운다.
   * 다음에 깨어날 시각(없으면 null)을 돌려준다.
   */
  runAll(options?: { manual?: boolean }): Promise<number | null>;
}

function usableSession(session: PendingPhotoSession | null): session is PendingPhotoSession {
  return (
    session !== null &&
    typeof session.userId === 'string' &&
    session.userId.length > 0 &&
    typeof session.accessToken === 'string' &&
    session.accessToken.length > 0
  );
}

export function createPendingPhotoRunner(deps: PendingPhotoRunnerDeps): PendingPhotoRunner {
  // 탭 안 표시: 같은 주문을 이 탭에서 겹쳐 보내지 않는다(Web Locks가 없는 브라우저의 첫 방어선).
  const inFlight = new Set<string>();
  let runningAll: Promise<number | null> | null = null;
  let rerunAll = false;

  const changed = () => {
    try {
      deps.onChanged?.();
    } catch {
      // 화면 갱신 실패는 대기열 동작에 영향을 주지 않는다.
    }
  };

  async function attempt(
    session: PendingPhotoSession,
    orderId: string,
    manual: boolean,
    lockHeld: boolean,
  ): Promise<PendingPhotoRunResult> {
    const key = pendingPhotoKey(session.userId, orderId);
    const now = deps.now();
    const found = await deps.store.get(key);
    if (!found || found.userId !== session.userId) return 'none';

    const expired = await deps.store.update(key, (current) => expirePendingPhoto(current, now));
    if (expired) {
      changed();
      deps.onFailed?.(expired);
      return 'failed';
    }
    if (found.state === 'failed') return 'failed';

    if (isPendingPhotoLeaseActive(found, now) && !lockHeld) return 'busy';
    if (manual) {
      const readyAt = pendingPhotoManualReadyAt(found);
      if (readyAt > now) {
        // 지금은 보내지 않고 가장 이른 시각으로 당겨 둔다(자동 실행이 그때 보낸다).
        const moved = await deps.store.update(key, (current) =>
          current.state === 'waiting' && current.nextAttemptAt > readyAt
            ? { ...current, nextAttemptAt: readyAt }
            : null,
        );
        if (moved) changed();
        return 'not-due';
      }
    } else if (!isPendingPhotoDue(found, now)) {
      return 'not-due';
    }
    if (!deps.isOnline()) return 'offline';

    let entry = await deps.store.update(key, (current) =>
      claimPendingPhotoLease(current, deps.now(), { lockHeld }),
    );
    if (!entry || entry.bytes === null) return 'busy';
    changed();

    let settled = false;
    try {
      // 판매자 ID를 아직 확인하지 못한 항목(보내기 전 실패)은 지금 확인한다.
      let storeId = entry.storeId;
      if (storeId === null) {
        const read = await deps.readStoreId(orderId, session.accessToken);
        if (read.kind === 'ok') {
          storeId = read.storeId;
          const resolved = storeId;
          entry =
            (await deps.store.update(key, (current) => ({ ...current, storeId: resolved }))) ??
            entry;
        } else if (read.kind === 'absent' || read.kind === 'authority') {
          const failed = await deps.store.update(key, (current) =>
            failPendingPhoto(current, read.kind === 'absent' ? 'NOT_FOUND' : 'AUTHORITY'),
          );
          settled = true;
          changed();
          if (failed) deps.onFailed?.(failed);
          return 'failed';
        } else {
          await deps.store.update(key, (current) =>
            deferPendingPhoto(
              current,
              read.kind === 'unauthorized' ? 'SESSION' : 'ORDER_UNKNOWN',
              deps.now(),
              deps.random(),
            ),
          );
          settled = true;
          changed();
          return read.kind === 'unauthorized' ? 'paused' : 'retry';
        }
      }

      const bytes = entry.bytes;
      const idempotencyKey = entry.idempotencyKey;
      if (bytes === null) return 'busy';
      // 저장한 바이트 그대로 보낸다(다시 인코딩하지 않는다).
      const send = (token: string) =>
        sendRoundDirectPhoto({
          post: deps.post,
          token,
          storeId: storeId as string,
          orderId,
          idempotencyKey,
          photo: new Blob([bytes], { type: 'image/jpeg' }),
        });

      let result: PendingPhotoSendResult = await send(session.accessToken);
      let counted: PendingPhotoEntry = entry;
      if (result.kind === 'failure' && result.status === 401) {
        // 세션을 한 번 다시 받아 같은 사용자의 새 토큰이면 한 번만 다시 보낸다.
        const refreshed = await deps.getSession().catch(() => null);
        if (
          usableSession(refreshed) &&
          refreshed.userId === session.userId &&
          refreshed.accessToken !== session.accessToken
        ) {
          // 첫 401 전송도 보낸 횟수로 센다.
          counted = { ...entry, attempts: entry.attempts + 1, lastAttemptAt: deps.now() };
          const renewed = deps.now() + PENDING_PHOTO_LEASE_MS;
          await deps.store.update(key, (current) =>
            current.state === 'sending' ? { ...current, leaseUntil: renewed } : null,
          );
          result = await send(refreshed.accessToken);
        }
      }

      const outcome = decidePendingPhotoOutcome({
        entry: counted,
        result,
        now: deps.now(),
        random: deps.random(),
      });
      settled = true;
      if (outcome.action === 'done') {
        await deps.store.delete(key);
        changed();
        deps.onCompleted?.(counted);
        return 'done';
      }
      // 그 사이 로그아웃 등으로 항목이 지워졌으면 되살리지 않는다(update는 있을 때만 쓴다).
      const written = await deps.store.update(key, () => outcome.entry);
      changed();
      if (outcome.action === 'fail') {
        if (written) deps.onFailed?.(written);
        return 'failed';
      }
      return outcome.entry.lastFailure === 'SESSION' ? 'paused' : 'retry';
    } finally {
      if (!settled) {
        await deps.store.update(key, (current) =>
          current.state === 'sending' ? releasePendingPhotoLease(current) : null,
        );
        changed();
      }
    }
  }

  async function runOrderWith(
    session: PendingPhotoSession,
    orderId: string,
    manual: boolean,
  ): Promise<PendingPhotoRunResult> {
    if (inFlight.has(orderId)) return 'busy';
    inFlight.add(orderId);
    try {
      if (deps.locks) {
        return await deps.locks.request(
          pendingPhotoLockName(orderId),
          { ifAvailable: true },
          async (lock) => (lock ? attempt(session, orderId, manual, true) : 'busy'),
        );
      }
      return await attempt(session, orderId, manual, false);
    } catch {
      return 'retry';
    } finally {
      inFlight.delete(orderId);
    }
  }

  async function currentSession(): Promise<PendingPhotoSession | null> {
    const session = await deps.getSession().catch(() => null);
    return usableSession(session) ? session : null;
  }

  async function runAllOnce(manual: boolean): Promise<number | null> {
    // 대기열이 비어 있으면(대부분의 경우) 세션도 묻지 않고 끝낸다.
    const entries = await deps.store.list();
    if (entries.length === 0) return null;
    const session = await currentSession();
    // 세션이 없으면(만료 포함) 아무것도 지우지 않고 멈춘다. 항목은 사용자 ID에 묶여 남는다.
    if (!session) return null;
    // 연결이 없으면 보내지 않는다. 연결 복구('online')가 다시 깨운다.
    const online = deps.isOnline();
    const { mine, others } = partitionPendingPhotosByUser(entries, session.userId);
    if (others.length > 0) {
      // 다른 사용자가 로그인했다: 이전 사용자의 사진은 보내지 않고 지운다.
      for (const entry of others)
        await deps.store.delete(pendingPhotoKey(entry.userId, entry.orderId));
      changed();
    }
    for (const entry of mine) {
      if (entry.state === 'failed') continue;
      if (!online) {
        // 만료만 정리한다.
        const now = deps.now();
        if (expirePendingPhoto(entry, now)) {
          const failed = await deps.store.update(
            pendingPhotoKey(entry.userId, entry.orderId),
            (current) => expirePendingPhoto(current, now),
          );
          if (failed) {
            changed();
            deps.onFailed?.(failed);
          }
        }
        continue;
      }
      const now = deps.now();
      if (!manual && !isPendingPhotoDue(entry, now) && !expirePendingPhoto(entry, now)) continue;
      await runOrderWith(session, entry.orderId, manual);
    }
    if (!online) return null;
    const remaining = partitionPendingPhotosByUser(await deps.store.list(), session.userId).mine;
    return nextPendingPhotoWakeAt(remaining);
  }

  return {
    async runOrder(orderId, options = {}) {
      const session = await currentSession();
      if (!session) return 'no-session';
      return runOrderWith(session, orderId, options.manual === true);
    },
    runAll(options = {}) {
      // 실행이 겹치면 지금 실행이 끝난 뒤 한 번 더 돈다(그 사이 들어온 항목을 놓치지 않게).
      if (runningAll) {
        rerunAll = true;
        return runningAll;
      }
      const run = (async () => {
        let next: number | null = null;
        do {
          rerunAll = false;
          next = await runAllOnce(options.manual === true).catch(() => null);
        } while (rerunAll);
        return next;
      })();
      runningAll = run.finally(() => {
        runningAll = null;
      });
      return runningAll;
    },
  };
}
