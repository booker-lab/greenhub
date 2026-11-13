/**
 * 배송 완료 사진 업로드 대기열(Y3)의 순수 판단 모음 (DOM·IndexedDB·네트워크 없음, node:test로 검증).
 *
 * 전파가 약한 곳에서 회차 직배송 완료 사진 업로드가 실패하거나 결과가 불확실하면, 기사는 화면을 떠나고
 * 앱이 열려 있는 동안 같은 사진을 나중에 자동으로 다시 보낸다. 주문은 DELIVERED로 한 번만 수렴해야 한다.
 *
 * 서버 계약 (apps/api/src/orders/delivery-photos.service.ts):
 * - photoId = sha256(orderId:idempotencyKey). 같은 키·같은 바이트 재전송은 멱등 ACK다
 *   (Storage ifGenerationMatch:0 + SHA 비교, 이미 연결·완료면 새 전이 없이 재조정).
 * - 그래서 대기열은 인코딩된 JPEG 바이트와 그때 쓴 멱등 키를 그대로 저장한다.
 *   encodeDeliveryJpeg는 결정적이지 않으므로 다시 인코딩하거나 키를 새로 만들지 않는다.
 * - 대기열은 사진 업로드 POST만 다시 보낸다. 별도 PATCH DELIVERED는 보내지 않는다.
 * - 기사 상세 GET은 DELIVERED 주문을 404로 숨기므로 완료 여부의 근거가 아니다. 근거는 같은 키 재전송 응답뿐이다.
 */

// 형식만 가져온다(실행 의존 없음): node:test가 이 파일을 그대로 불러온다.
// 불확실 판정·안내 문구가 photo-upload-policy와 같은지는 pending-photo-policy.test.mjs가 확인한다.
import type { PhotoUploadFailureKind } from './photo-upload-policy';

export const PENDING_PHOTO_DB_NAME = 'greenhub-driver-pending-photos';
export const PENDING_PHOTO_DB_VERSION = 1;
export const PENDING_PHOTO_OBJECT_STORE = 'entries';
export const PENDING_PHOTO_ENTRY_VERSION = 1;

/** 이 시간이 지나도록 올리지 못하면 자동 재전송을 멈추고 기사에게 확인을 맡긴다. */
export const PENDING_PHOTO_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * 보내는 중 표시(lease) 유지 시간. 사진 업로드 시간 제한(90초)보다 길다.
 * 탭이 보내는 도중 닫혀도 이 시간이 지나면 다른 실행이 이어받는다.
 */
export const PENDING_PHOTO_LEASE_MS = 2 * 60 * 1000;

/** 자동 재시도 간격(화면이 보이는 동안). 마지막 값이 상한이다. */
export const PENDING_PHOTO_BACKOFF_MS: readonly number[] = [30_000, 60_000, 120_000, 300_000];

/** 간격에 더하는 흔들림 비율(0~이 비율만큼 더한다). 더하기만 하므로 첫 재시도는 30초보다 이르지 않다. */
export const PENDING_PHOTO_JITTER_RATIO = 0.2;

/**
 * 보낸 요청의 결과가 불확실하면(시간 초과 포함) 서버가 아직 처리 중일 수 있다.
 * 같은 키 요청 두 개가 겹치면 늦은 쪽이 완료됐는데도 409를 받으므로 이 시간 안에는 다시 보내지 않는다.
 */
export const PENDING_PHOTO_MIN_RESEND_GAP_MS = 30_000;

/** 서버 multer 한도(5MB)와 같다. 이보다 큰 저장 값은 깨진 항목으로 본다. */
const PENDING_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** 서버 assertIdempotencyKey와 같은 형식. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
/** 서버 SAFE_ID_PATTERN(주문·판매자 ID)과 같은 형식. ':'가 없어 저장 키가 모호하지 않다. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_USER_ID_LENGTH = 256;

/** 결과가 불확실한 실패(photo-upload-policy isUncertainPhotoUploadFailure와 같다). */
export function isUncertainPendingSendFailure(kind: PhotoUploadFailureKind): boolean {
  return kind === 'NETWORK' || kind === 'SERVER' || kind === 'ACK_UNCONFIRMED';
}

export type PendingPhotoState = 'waiting' | 'sending' | 'failed';

/** 항목의 마지막 실패. 앞 묶음은 다시 시도하고, 뒤 묶음은 멈춘(failed) 항목이다. */
export type PendingPhotoFailure =
  // 보내기 전 실패: 서버는 이 사진을 받지 않았다.
  | 'OFFLINE'
  | 'ORDER_UNKNOWN'
  // 보낸 뒤 불확실: 서버가 처리했을 수 있다. 같은 키·같은 바이트로만 다시 보낸다.
  | 'NETWORK'
  | 'SERVER'
  | 'ACK_UNCONFIRMED'
  // 불확실한 요청 뒤 상태 충돌: 겹친 같은 키 요청일 수 있어 한 번만 확인 재전송한다.
  | 'CONFLICT_UNCONFIRMED'
  // 로그인 확인 실패: 같은 사용자의 유효한 세션이 생길 때까지 멈춘다.
  | 'SESSION'
  // 멈춤(failed): 다시 보내지 않는다. 사진 바이트는 지우고 기사가 확인할 때까지 항목만 남긴다.
  | 'AUTHORITY'
  | 'NOT_FOUND'
  | 'TOO_LARGE'
  | 'REJECTED'
  | 'STATE_CONFLICT'
  | 'EXPIRED';

const RETRYABLE_FAILURES: readonly PendingPhotoFailure[] = [
  'OFFLINE',
  'ORDER_UNKNOWN',
  'NETWORK',
  'SERVER',
  'ACK_UNCONFIRMED',
  'CONFLICT_UNCONFIRMED',
  'SESSION',
];

const TERMINAL_FAILURES: readonly PendingPhotoFailure[] = [
  'AUTHORITY',
  'NOT_FOUND',
  'TOO_LARGE',
  'REJECTED',
  'STATE_CONFLICT',
  'EXPIRED',
];

export interface PendingPhotoEntry {
  v: 1;
  userId: string;
  orderId: string;
  /** 보내기 전 판매자 ID를 확인하지 못했으면 null이고 실행 때 다시 확인한다. */
  storeId: string | null;
  idempotencyKey: string;
  /** 처음 보낸(또는 보내려던) 인코딩된 JPEG 그대로. 멈춘(failed) 항목은 null이다. */
  bytes: ArrayBuffer | null;
  createdAt: number;
  /** 서버로 실제 보낸 횟수. 0이면 서버는 이 키를 본 적이 없다. */
  attempts: number;
  /** 마지막으로 보낸 시각. 보낸 적이 없으면 0. */
  lastAttemptAt: number;
  lastFailure: PendingPhotoFailure | null;
  state: PendingPhotoState;
  nextAttemptAt: number;
  /** 보내는 중 표시 만료 시각. 보내는 중이 아니면 0. */
  leaseUntil: number;
}

/** 화면 표시용 요약. 사진 바이트를 들고 다니지 않는다. */
export type PendingPhotoSummary = Omit<PendingPhotoEntry, 'bytes'>;

export function toPendingPhotoSummary(entry: PendingPhotoEntry): PendingPhotoSummary {
  const { bytes: _bytes, ...summary } = entry;
  return summary;
}

export function pendingPhotoKey(userId: string, orderId: string): string {
  return `${userId}:${orderId}`;
}

export function pendingPhotoLockName(orderId: string): string {
  return `pending-photo:${orderId}`;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  // 다른 realm(IndexedDB 구조적 복제)의 ArrayBuffer도 받도록 instanceof 대신 태그로 본다.
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

/**
 * 저장소에서 읽은 값을 항목으로 읽는다. 형식이 하나라도 맞지 않으면 null(깨진 항목은 버린다, fail-closed).
 * - 기다림·보내는 중 항목은 사진 바이트가 있어야 하고, 멈춘 항목은 바이트가 없어야 한다.
 * - 저장 키가 있으면 `${userId}:${orderId}`와 같아야 한다.
 */
export function readPendingPhotoEntry(
  value: unknown,
  storageKey?: unknown,
): PendingPhotoEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (entry.v !== PENDING_PHOTO_ENTRY_VERSION) return null;
  const { userId, orderId, storeId, idempotencyKey, bytes, state, lastFailure } = entry;
  if (typeof userId !== 'string' || userId.length === 0 || userId.length > MAX_USER_ID_LENGTH) {
    return null;
  }
  if (typeof orderId !== 'string' || !SAFE_ID_PATTERN.test(orderId)) return null;
  if (storeId !== null && (typeof storeId !== 'string' || !SAFE_ID_PATTERN.test(storeId))) {
    return null;
  }
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return null;
  }
  if (state !== 'waiting' && state !== 'sending' && state !== 'failed') return null;
  if (state === 'failed') {
    if (bytes !== null) return null;
    if (typeof lastFailure !== 'string' || !TERMINAL_FAILURES.includes(lastFailure as never)) {
      return null;
    }
  } else {
    if (
      !isArrayBuffer(bytes) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > PENDING_PHOTO_MAX_BYTES
    ) {
      return null;
    }
    if (
      lastFailure !== null &&
      (typeof lastFailure !== 'string' || !RETRYABLE_FAILURES.includes(lastFailure as never))
    ) {
      return null;
    }
  }
  const { createdAt, attempts, lastAttemptAt, nextAttemptAt, leaseUntil } = entry;
  if (
    !isFiniteNonNegative(createdAt) ||
    !isFiniteNonNegative(attempts) ||
    !Number.isInteger(attempts) ||
    !isFiniteNonNegative(lastAttemptAt) ||
    !isFiniteNonNegative(nextAttemptAt) ||
    !isFiniteNonNegative(leaseUntil)
  ) {
    return null;
  }
  if (storageKey !== undefined && storageKey !== pendingPhotoKey(userId, orderId)) return null;
  return {
    v: PENDING_PHOTO_ENTRY_VERSION,
    userId,
    orderId,
    storeId,
    idempotencyKey,
    bytes: state === 'failed' ? null : (bytes as ArrayBuffer),
    createdAt,
    attempts,
    lastAttemptAt,
    lastFailure: lastFailure as PendingPhotoFailure | null,
    state,
    nextAttemptAt,
    leaseUntil,
  };
}

/** 보내기 전 실패 원인. 서버는 이 사진을 받지 않았다. */
export type PendingPhotoPreSendReason = 'OFFLINE' | 'ORDER_UNKNOWN';

export type PendingPhotoEnqueueInput =
  | { phase: 'pre-send'; reason: PendingPhotoPreSendReason }
  | { phase: 'sent'; failure: PhotoUploadFailureKind };

/**
 * 이 실패를 대기열에 넣을지. 보내기 전 실패(오프라인·판매자 ID 확인 실패)와 보낸 뒤 불확실한 결과
 * (네트워크·시간 초과·5xx/408/429·응답 미확인)만 넣는다. 확정 거절(용량·거절·없음·권한·상태 충돌)은
 * 지금처럼 화면에서 안내한다.
 */
export function shouldEnqueuePendingPhoto(input: PendingPhotoEnqueueInput): boolean {
  if (input.phase === 'pre-send') return true;
  return isUncertainPendingSendFailure(input.failure);
}

function toPendingFailure(kind: PhotoUploadFailureKind): PendingPhotoFailure {
  if (kind === 'NETWORK' || kind === 'SERVER' || kind === 'ACK_UNCONFIRMED') return kind;
  if (kind === 'AUTHORITY' || kind === 'NOT_FOUND' || kind === 'TOO_LARGE') return kind;
  if (kind === 'STATE_CONFLICT') return 'STATE_CONFLICT';
  return 'REJECTED';
}

/**
 * n번째 자동 재시도 간격(ms). step은 0부터이고 상한(5분)을 넘지 않는다.
 * 흔들림은 더하기만 하므로 결과는 기본 간격 이상, 기본 간격×(1+비율) 이하다.
 */
export function pendingPhotoBackoffMs(step: number, random: number): number {
  const index = Math.min(Math.max(0, Math.floor(step)), PENDING_PHOTO_BACKOFF_MS.length - 1);
  const base = PENDING_PHOTO_BACKOFF_MS[index] ?? PENDING_PHOTO_BACKOFF_MS[0];
  const jitter = Number.isFinite(random) ? Math.min(Math.max(random, 0), 1) : 0;
  return Math.round(base * (1 + PENDING_PHOTO_JITTER_RATIO * jitter));
}

/** 대기열에 넣을 새 항목. 보낸 뒤 불확실이면 첫 재시도는 30초 뒤보다 이르지 않다. */
export function createPendingPhotoEntry(args: {
  userId: string;
  orderId: string;
  storeId: string | null;
  idempotencyKey: string;
  bytes: ArrayBuffer;
  now: number;
  random: number;
  input: PendingPhotoEnqueueInput;
}): PendingPhotoEntry | null {
  if (!shouldEnqueuePendingPhoto(args.input)) return null;
  const sent = args.input.phase === 'sent';
  const lastFailure: PendingPhotoFailure =
    args.input.phase === 'sent' ? toPendingFailure(args.input.failure) : args.input.reason;
  const nextAttemptAt =
    sent || lastFailure === 'ORDER_UNKNOWN'
      ? args.now + pendingPhotoBackoffMs(0, args.random)
      : args.now;
  return readPendingPhotoEntry({
    v: PENDING_PHOTO_ENTRY_VERSION,
    userId: args.userId,
    orderId: args.orderId,
    storeId: args.storeId,
    idempotencyKey: args.idempotencyKey,
    bytes: args.bytes,
    createdAt: args.now,
    attempts: sent ? 1 : 0,
    lastAttemptAt: sent ? args.now : 0,
    lastFailure,
    state: 'waiting',
    nextAttemptAt,
    leaseUntil: 0,
  });
}

export function isPendingPhotoExpired(entry: PendingPhotoSummary, now: number): boolean {
  // 기기 시계가 되돌아가 만든 시각이 미래면 만료로 보지 않는다(다음 실행에서 다시 본다).
  return now - entry.createdAt >= PENDING_PHOTO_MAX_AGE_MS;
}

/** 보내는 중 표시가 살아 있는가(다른 탭·실행이 보내는 중). */
export function isPendingPhotoLeaseActive(entry: PendingPhotoSummary, now: number): boolean {
  return entry.state === 'sending' && entry.leaseUntil > now;
}

/** 자동 실행이 지금 보낼 차례인가. */
export function isPendingPhotoDue(entry: PendingPhotoSummary, now: number): boolean {
  if (entry.state === 'failed') return false;
  if (entry.state === 'sending') return entry.leaseUntil <= now;
  return entry.nextAttemptAt <= now;
}

/**
 * "지금 올리기"로 바로 보낼 수 있는 가장 이른 시각. 기사가 눌러도 간격(재시도 대기)은 건너뛰지만,
 * 불확실한 요청 뒤 30초 안에는 보내지 않고(겹친 같은 키 요청의 409를 피한다),
 * 상태 충돌 확인 재전송은 예정 시각을 지킨다.
 */
export function pendingPhotoManualReadyAt(entry: PendingPhotoSummary): number {
  if (entry.lastFailure === 'CONFLICT_UNCONFIRMED') return entry.nextAttemptAt;
  if (entry.lastAttemptAt <= 0) return 0;
  return entry.lastAttemptAt + PENDING_PHOTO_MIN_RESEND_GAP_MS;
}

/**
 * 보내기 직전 보내는 중 표시를 잡는다. 잡을 수 없으면 null.
 * - 멈춘 항목은 잡지 않는다.
 * - 다른 실행의 표시가 살아 있으면 잡지 않는다. 단 탭 사이 잠금(Web Locks)을 쥐었으면
 *   남은 표시는 닫힌 탭의 흔적이므로 이어받는다.
 */
export function claimPendingPhotoLease(
  entry: PendingPhotoEntry,
  now: number,
  options: { lockHeld: boolean },
): PendingPhotoEntry | null {
  if (entry.state === 'failed' || entry.bytes === null) return null;
  if (isPendingPhotoLeaseActive(entry, now) && !options.lockHeld) return null;
  return { ...entry, state: 'sending', leaseUntil: now + PENDING_PHOTO_LEASE_MS };
}

/** 보내는 중 표시를 풀어 다시 기다림으로 둔다(실행이 중간에 끝난 경우). */
export function releasePendingPhotoLease(entry: PendingPhotoEntry): PendingPhotoEntry {
  if (entry.state !== 'sending') return entry;
  return { ...entry, state: 'waiting', leaseUntil: 0 };
}

/** 멈춘 항목. 사진 바이트는 바로 지운다. */
export function failPendingPhoto(
  entry: PendingPhotoEntry,
  failure: PendingPhotoFailure,
): PendingPhotoEntry {
  return { ...entry, state: 'failed', bytes: null, lastFailure: failure, leaseUntil: 0 };
}

/** 보내기 전에 다시 기다리게 한다(판매자 ID 확인 실패·오프라인·세션 확인 실패). 보낸 횟수는 늘리지 않는다. */
export function deferPendingPhoto(
  entry: PendingPhotoEntry,
  failure: 'OFFLINE' | 'ORDER_UNKNOWN' | 'SESSION',
  now: number,
  random: number,
): PendingPhotoEntry {
  return {
    ...entry,
    state: 'waiting',
    leaseUntil: 0,
    lastFailure: failure,
    nextAttemptAt: now + pendingPhotoBackoffMs(Math.max(0, entry.attempts - 1), random),
  };
}

/** 한 번 보낸 결과. status는 HTTP 응답이 있었을 때만 있다. */
export type PendingPhotoSendResult =
  | { kind: 'ack' }
  | { kind: 'failure'; failure: PhotoUploadFailureKind; status: number | null };

export type PendingPhotoOutcome =
  | { action: 'done' }
  | { action: 'retry'; entry: PendingPhotoEntry }
  | { action: 'fail'; entry: PendingPhotoEntry };

/**
 * 같은 키 재전송 결과로 다음 항목 상태를 정한다. entry는 이번 전송 전 항목이고, 이번 전송을 세어 넣는다.
 * - ACK → 끝(항목 삭제).
 * - 불확실(네트워크·시간 초과·5xx/408/429·응답 미확인) → 간격을 두고 다시.
 * - 401(세션을 한 번 다시 받아도) → 같은 사용자의 유효한 세션을 기다리며 다시.
 * - 상태 충돌: 앞서 보낸 불확실한 요청이 있었으면(겹친 같은 키 요청일 수 있다) 30초 이상 뒤 한 번만
 *   확인 재전송하고, 그 확인도 충돌이면 멈춘다. 앞선 요청이 없었으면 바로 멈춘다.
 * - 403 권한·404·413·그 밖의 4xx → 멈춤.
 */
export function decidePendingPhotoOutcome(args: {
  entry: PendingPhotoEntry;
  result: PendingPhotoSendResult;
  now: number;
  random: number;
}): PendingPhotoOutcome {
  const { result, now, random } = args;
  if (result.kind === 'ack') return { action: 'done' };
  const sentBefore = args.entry.attempts;
  const entry: PendingPhotoEntry = {
    ...args.entry,
    attempts: sentBefore + 1,
    lastAttemptAt: now,
    state: 'waiting',
    leaseUntil: 0,
  };
  const { failure, status } = result;
  if (isUncertainPendingSendFailure(failure)) {
    return {
      action: 'retry',
      entry: {
        ...entry,
        lastFailure: failure as PendingPhotoFailure,
        nextAttemptAt: now + pendingPhotoBackoffMs(sentBefore, random),
      },
    };
  }
  if (status === 401) {
    return {
      action: 'retry',
      entry: {
        ...entry,
        lastFailure: 'SESSION',
        nextAttemptAt: now + pendingPhotoBackoffMs(sentBefore, random),
      },
    };
  }
  if (failure === 'STATE_CONFLICT') {
    const confirmationPending = args.entry.lastFailure !== 'CONFLICT_UNCONFIRMED' && sentBefore > 0;
    if (confirmationPending) {
      return {
        action: 'retry',
        entry: {
          ...entry,
          lastFailure: 'CONFLICT_UNCONFIRMED',
          nextAttemptAt:
            now + Math.max(PENDING_PHOTO_MIN_RESEND_GAP_MS, pendingPhotoBackoffMs(0, random)),
        },
      };
    }
    return { action: 'fail', entry: failPendingPhoto(entry, 'STATE_CONFLICT') };
  }
  return { action: 'fail', entry: failPendingPhoto(entry, toPendingFailure(failure)) };
}

/** 만료된 기다림 항목을 멈춘다. 보내는 중 표시가 살아 있으면(다른 실행이 보내는 중) 두고 본다. */
export function expirePendingPhoto(
  entry: PendingPhotoEntry,
  now: number,
): PendingPhotoEntry | null {
  if (entry.state === 'failed' || !isPendingPhotoExpired(entry, now)) return null;
  if (isPendingPhotoLeaseActive(entry, now)) return null;
  return failPendingPhoto(entry, 'EXPIRED');
}

/** 로그인한 사용자 항목과 다른 사용자 항목으로 나눈다. 실행은 내 항목만 하고 다른 사용자 항목은 지운다. */
export function partitionPendingPhotosByUser<T extends { userId: string }>(
  entries: readonly T[],
  userId: string,
): { mine: T[]; others: T[] } {
  const mine: T[] = [];
  const others: T[] = [];
  for (const entry of entries) {
    if (entry.userId === userId) mine.push(entry);
    else others.push(entry);
  }
  return { mine, others };
}

/** 자동 실행이 다음에 깨어날 시각. 기다릴 항목이 없으면 null. */
export function nextPendingPhotoWakeAt(entries: readonly PendingPhotoSummary[]): number | null {
  let next: number | null = null;
  for (const entry of entries) {
    if (entry.state === 'failed') continue;
    // 오프라인 항목은 연결 이벤트('online')가 깨운다.
    const at = entry.state === 'sending' ? entry.leaseUntil : entry.nextAttemptAt;
    if (next === null || at < next) next = at;
  }
  return next;
}

export type PendingPhotoBadgeKind = 'sending' | 'waiting' | 'failed';

export const PENDING_PHOTO_BADGE_LABEL: Record<PendingPhotoBadgeKind, string> = {
  sending: '사진 올리는 중',
  waiting: '사진 올리기 대기',
  failed: '사진 등록 실패',
};

/** 목록 행·상세 표시 상태. 보내는 중 표시가 끝났으면(닫힌 탭) 기다림으로 보인다. */
export function pendingPhotoBadgeKind(
  entry: PendingPhotoSummary,
  now: number,
): PendingPhotoBadgeKind {
  if (entry.state === 'failed') return 'failed';
  return isPendingPhotoLeaseActive(entry, now) ? 'sending' : 'waiting';
}

export const PENDING_PHOTO_MESSAGES = {
  ENQUEUED:
    '사진을 휴대폰에 저장했어요. 신호가 잡히면 앱이 자동으로 올려요. 앱을 열어 두면 더 빨리 올라가요.',
  WAITING: '사진을 휴대폰에 저장했어요. 신호가 잡히면 앱이 자동으로 올려요.',
  SENDING: '사진을 올리고 있어요.',
  SESSION: '로그인을 다시 확인하면 이어서 올려요.',
  COMPLETED: '배송 완료 사진을 올렸어요',
  SOON: '조금 전에 보낸 사진의 결과를 기다리고 있어요. 잠시 뒤 다시 올려요.',
  // 아래 셋은 사진 화면 안내(photo-upload-policy PHOTO_UPLOAD_MESSAGES)와 같은 문구다.
  NOT_FOUND: '주문을 찾을 수 없어요. 판매자 또는 운영팀에 연락해 주세요.',
  TOO_LARGE: '사진 용량이 너무 커요. 다시 촬영하거나 다른 사진을 선택해 주세요.',
  REJECTED: '사진을 등록하지 못했어요. 다시 촬영해 주세요.',
  AUTHORITY: '처리 권한이 없어요',
  STATE_CONFLICT: '주문 상태가 바뀌었어요. 목록에서 확인해 주세요',
  EXPIRED: '올리지 못한 채 12시간이 지났어요. 주문 화면에서 확인해 주세요',
} as const;

/** 항목 상태 안내 문구. */
export function pendingPhotoStatusMessage(entry: PendingPhotoSummary, now: number): string {
  if (entry.state === 'failed') {
    switch (entry.lastFailure) {
      case 'AUTHORITY':
        return PENDING_PHOTO_MESSAGES.AUTHORITY;
      case 'STATE_CONFLICT':
        return PENDING_PHOTO_MESSAGES.STATE_CONFLICT;
      case 'EXPIRED':
        return PENDING_PHOTO_MESSAGES.EXPIRED;
      case 'NOT_FOUND':
        return PENDING_PHOTO_MESSAGES.NOT_FOUND;
      case 'TOO_LARGE':
        return PENDING_PHOTO_MESSAGES.TOO_LARGE;
      default:
        return PENDING_PHOTO_MESSAGES.REJECTED;
    }
  }
  if (isPendingPhotoLeaseActive(entry, now)) return PENDING_PHOTO_MESSAGES.SENDING;
  if (entry.lastFailure === 'SESSION') return PENDING_PHOTO_MESSAGES.SESSION;
  return PENDING_PHOTO_MESSAGES.WAITING;
}

/** 목록에 없는 주문의 사진 안내 제목. */
export function pendingPhotoBannerTitle(count: number): string {
  return `처리 중인 사진 ${count}건`;
}
