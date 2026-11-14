import { describe, expect, it } from 'vitest';
import { ApiTimeoutError } from '../../../../lib/api-timeout';
import {
  PENDING_PHOTO_LEASE_MS,
  PENDING_PHOTO_MAX_AGE_MS,
  PENDING_PHOTO_MESSAGES,
  type PendingPhotoEntry,
  pendingPhotoCompletedMessage,
  pendingPhotoKey,
} from './pending-photo-policy';
import {
  createPendingPhotoRunner,
  type PendingPhotoLockManager,
  type PendingPhotoRunnerDeps,
  type PendingPhotoSession,
  type PendingPhotoStoreIdRead,
} from './pending-photo-runner';
import { createMemoryPendingPhotoStore } from './pending-photo-store';
import { sendRoundDirectPhoto } from './round-direct-send';

const NOW = Date.UTC(2026, 10, 13, 9, 0, 0);
const KEY = '0f8c2a4e-6d1b-4c3a-9e2f-7a5b8c9d0e1f';

function photoBytes(seed = 7, size = 64): ArrayBuffer {
  const view = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) view[index] = (seed + index) % 256;
  return view.buffer;
}

function makeEntry(overrides: Partial<PendingPhotoEntry> = {}): PendingPhotoEntry {
  return {
    v: 1,
    userId: 'driver-1',
    orderId: 'order-1',
    storeId: 'store-1',
    idempotencyKey: KEY,
    bytes: photoBytes(),
    createdAt: NOW - 60_000,
    attempts: 1,
    lastAttemptAt: NOW - 60_000,
    lastFailure: 'NETWORK',
    state: 'waiting',
    nextAttemptAt: NOW - 1,
    leaseUntil: 0,
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ack = (orderId = 'order-1') =>
  json(200, { orderId, photoId: 'a'.repeat(32), status: 'DELIVERED' });

type SentRequest = {
  path: string;
  token: string;
  method: string;
  idempotencyKey: string | null;
  /** 보내지 않았으면 null. */
  expectedHoldAt: string | null;
  photo: Uint8Array;
  photoType: string;
};

function makeHarness(
  options: {
    entries?: PendingPhotoEntry[];
    responses?: Array<Response | Error | (() => Promise<Response>)>;
    sessions?: Array<PendingPhotoSession | null>;
    storeIdRead?: PendingPhotoStoreIdRead;
    locks?: PendingPhotoLockManager | null;
    online?: boolean;
    now?: number;
  } = {},
) {
  const store = createMemoryPendingPhotoStore();
  for (const entry of options.entries ?? []) {
    store.raw.set(pendingPhotoKey(entry.userId, entry.orderId), entry);
  }
  const responses = [...(options.responses ?? [])];
  const sessions = [...(options.sessions ?? [{ userId: 'driver-1', accessToken: 'token-1' }])];
  const lastSession = sessions[sessions.length - 1] ?? null;
  const sent: SentRequest[] = [];
  const pending: Array<Promise<void>> = [];
  const completed: PendingPhotoEntry[] = [];
  const failed: PendingPhotoEntry[] = [];
  const storeIdReads: string[] = [];
  let now = options.now ?? NOW;
  let sessionCalls = 0;

  const post: PendingPhotoRunnerDeps['post'] = async (path, token, init) => {
    const form = init.body;
    const photo = form.get('photo');
    const record: SentRequest = {
      path,
      token,
      method: init.method,
      idempotencyKey: form.get('idempotencyKey') as string | null,
      expectedHoldAt: form.get('expectedHoldAt') as string | null,
      photo: new Uint8Array(0),
      photoType: photo instanceof Blob ? photo.type : '',
    };
    sent.push(record);
    if (photo instanceof Blob) {
      const read = photo.arrayBuffer().then((buffer) => {
        record.photo = new Uint8Array(buffer);
      });
      pending.push(read);
      await read;
    }
    const next = responses.shift();
    if (next === undefined) throw new Error('예상보다 많은 요청');
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next();
    return next;
  };

  const deps: PendingPhotoRunnerDeps = {
    store,
    getSession: async () => {
      sessionCalls += 1;
      return sessions.length > 0 ? (sessions.shift() ?? null) : lastSession;
    },
    post,
    readStoreId: async (orderId) => {
      storeIdReads.push(orderId);
      return options.storeIdRead ?? { kind: 'ok', storeId: 'store-1' };
    },
    now: () => now,
    random: () => 0,
    isOnline: () => options.online ?? true,
    locks: options.locks ?? null,
    onCompleted: (entry) => completed.push(entry),
    onFailed: (entry) => failed.push(entry),
  };
  const runner = createPendingPhotoRunner(deps);
  return {
    runner,
    deps,
    store,
    sent,
    completed,
    failed,
    storeIdReads,
    get sessionCalls() {
      return sessionCalls;
    },
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
    settled: () => Promise.all(pending),
  };
}

const ORIGINAL = new Uint8Array(photoBytes());

describe('사진 업로드 대기열 실행기', () => {
  it('같은 키·같은 바이트로 사진 업로드 POST만 보내고 ACK면 항목을 지운다', async () => {
    const harness = makeHarness({ entries: [makeEntry()], responses: [ack()] });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('done');

    expect(harness.sent).toHaveLength(1);
    const [request] = harness.sent;
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/stores/store-1/orders/order-1/delivery-photos');
    expect(request.token).toBe('token-1');
    expect(request.idempotencyKey).toBe(KEY);
    expect(request.photoType).toBe('image/jpeg');
    expect(request.photo).toEqual(ORIGINAL);
    expect(harness.store.raw.size).toBe(0);
    expect(harness.completed.map((entry) => entry.orderId)).toEqual(['order-1']);
  });

  it('불확실이 이어져도 키·바이트를 다시 만들지 않고, 간격이 지나야 다시 보낸다', async () => {
    const harness = makeHarness({
      entries: [makeEntry()],
      responses: [new ApiTimeoutError(90_000), json(503, {}), ack()],
    });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('retry');
    const afterTimeout = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(afterTimeout.lastFailure).toBe('NETWORK');
    expect(afterTimeout.attempts).toBe(2);
    expect(afterTimeout.state).toBe('waiting');
    // 시간 초과 뒤 첫 재시도는 30초보다 이르지 않다.
    expect(afterTimeout.nextAttemptAt - harness.now).toBeGreaterThanOrEqual(30_000);
    await expect(harness.runner.runOrder('order-1')).resolves.toBe('not-due');
    expect(harness.sent).toHaveLength(1);

    harness.advance(afterTimeout.nextAttemptAt - harness.now);
    await expect(harness.runner.runOrder('order-1')).resolves.toBe('retry');
    const afterServer = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(afterServer.lastFailure).toBe('SERVER');
    expect(afterServer.nextAttemptAt - harness.now).toBe(120_000);

    harness.advance(120_000);
    await expect(harness.runner.runOrder('order-1')).resolves.toBe('done');
    await harness.settled();
    expect(harness.sent).toHaveLength(3);
    for (const request of harness.sent) {
      expect(request.idempotencyKey).toBe(KEY);
      expect(request.photo).toEqual(ORIGINAL);
      expect(request.method).toBe('POST');
      expect(request.path.endsWith('/delivery-photos')).toBe(true);
    }
    expect(harness.completed).toHaveLength(1);
  });

  it('로그인한 사용자 항목만 보내고 다른 사용자 항목은 지운다', async () => {
    const harness = makeHarness({
      entries: [
        makeEntry({ userId: 'driver-1', orderId: 'order-1' }),
        makeEntry({ userId: 'driver-2', orderId: 'order-2' }),
      ],
      responses: [ack('order-1')],
    });

    await harness.runner.runAll();

    expect(harness.sent.map((request) => request.path)).toEqual([
      '/stores/store-1/orders/order-1/delivery-photos',
    ]);
    expect(harness.store.raw.size).toBe(0);
    // 다른 사용자 주문은 그 사용자 키로도 보내지 않는다.
    await expect(harness.runner.runOrder('order-2')).resolves.toBe('none');
  });

  it('세션이 없으면(만료) 아무것도 보내거나 지우지 않는다', async () => {
    const harness = makeHarness({
      entries: [makeEntry(), makeEntry({ userId: 'driver-2', orderId: 'order-2' })],
      sessions: [null],
    });

    await expect(harness.runner.runAll()).resolves.toBeNull();
    await expect(harness.runner.runOrder('order-1')).resolves.toBe('no-session');
    expect(harness.sent).toHaveLength(0);
    expect(harness.store.raw.size).toBe(2);
  });

  it('401이면 세션을 한 번 다시 받아 같은 사용자의 새 토큰으로 한 번만 다시 보낸다', async () => {
    const harness = makeHarness({
      entries: [makeEntry()],
      sessions: [
        { userId: 'driver-1', accessToken: 'token-old' },
        { userId: 'driver-1', accessToken: 'token-new' },
      ],
      responses: [json(401, {}), ack()],
    });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('done');
    expect(harness.sent.map((request) => request.token)).toEqual(['token-old', 'token-new']);
    expect(harness.sent.map((request) => request.idempotencyKey)).toEqual([KEY, KEY]);
    expect(harness.sessionCalls).toBe(2);
  });

  it('다시 받아도 401이면 멈추고(SESSION) 그 이상 보내지 않는다', async () => {
    const harness = makeHarness({
      entries: [makeEntry()],
      sessions: [
        { userId: 'driver-1', accessToken: 'token-old' },
        { userId: 'driver-1', accessToken: 'token-new' },
      ],
      responses: [json(401, {}), json(401, {})],
    });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('paused');
    expect(harness.sent).toHaveLength(2);
    const entry = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(entry.lastFailure).toBe('SESSION');
    expect(entry.state).toBe('waiting');
    expect(entry.attempts).toBe(3);
    expect(entry.bytes).not.toBeNull();
  });

  it('다시 받은 세션이 같은 토큰이거나 다른 사용자면 다시 보내지 않고 멈춘다', async () => {
    for (const refreshed of [
      { userId: 'driver-1', accessToken: 'token-1' },
      { userId: 'driver-2', accessToken: 'token-2' },
      null,
    ]) {
      const harness = makeHarness({
        entries: [makeEntry()],
        sessions: [{ userId: 'driver-1', accessToken: 'token-1' }, refreshed],
        responses: [json(401, {})],
      });
      await expect(harness.runner.runOrder('order-1')).resolves.toBe('paused');
      expect(harness.sent).toHaveLength(1);
    }
  });

  it('탭 사이 잠금을 다른 쪽이 쥐고 있으면 보내지 않는다', async () => {
    const requested: string[] = [];
    const locks: PendingPhotoLockManager = {
      request: async (name, _options, callback) => {
        requested.push(name);
        return callback(null);
      },
    };
    const harness = makeHarness({ entries: [makeEntry()], locks });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('busy');
    expect(requested).toEqual(['pending-photo:order-1']);
    expect(harness.sent).toHaveLength(0);
  });

  it('잠금을 쥐면 닫힌 탭이 남긴 보내는 중 표시를 이어받는다', async () => {
    const locks: PendingPhotoLockManager = {
      request: async (_name, _options, callback) => callback({ name: 'held' }),
    };
    const harness = makeHarness({
      entries: [makeEntry({ state: 'sending', leaseUntil: NOW + 60_000 })],
      locks,
      responses: [ack()],
    });

    await expect(harness.runner.runOrder('order-1', { manual: true })).resolves.toBe('done');
    expect(harness.sent).toHaveLength(1);
  });

  it('잠금이 없는 브라우저: 같은 탭의 겹친 실행과 다른 탭의 보내는 중 표시를 막는다', async () => {
    let release!: (response: Response) => void;
    const harness = makeHarness({
      entries: [makeEntry()],
      responses: [() => new Promise<Response>((resolve) => (release = resolve))],
    });

    const first = harness.runner.runOrder('order-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(harness.runner.runOrder('order-1', { manual: true })).resolves.toBe('busy');
    const during = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(during.state).toBe('sending');
    expect(during.leaseUntil).toBe(NOW + PENDING_PHOTO_LEASE_MS);

    // 다른 탭(다른 실행기)은 살아 있는 표시를 보고 보내지 않는다.
    const otherTab = createPendingPhotoRunner({
      store: harness.store,
      getSession: async () => ({ userId: 'driver-1', accessToken: 'token-1' }),
      post: async () => {
        throw new Error('보내면 안 된다');
      },
      readStoreId: async () => ({ kind: 'unknown' }),
      now: () => NOW,
      random: () => 0,
      isOnline: () => true,
      locks: null,
    });
    await expect(otherTab.runOrder('order-1', { manual: true })).resolves.toBe('busy');

    release(ack());
    await expect(first).resolves.toBe('done');
    expect(harness.sent).toHaveLength(1);
  });

  it('불확실한 요청 뒤 409는 30초 뒤 한 번 확인 재전송하고, ACK면 완료로 수렴한다', async () => {
    const conflict = json(409, { code: 'DRIVER_ORDER_STATE_CONFLICT' });
    const harness = makeHarness({ entries: [makeEntry()], responses: [conflict, ack()] });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('retry');
    const entry = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(entry.lastFailure).toBe('CONFLICT_UNCONFIRMED');
    expect(entry.nextAttemptAt - harness.now).toBeGreaterThanOrEqual(30_000);
    // 확인 재전송은 "지금 올리기"로도 당기지 않는다.
    await expect(harness.runner.runOrder('order-1', { manual: true })).resolves.toBe('not-due');
    expect(harness.sent).toHaveLength(1);

    harness.advance(entry.nextAttemptAt - harness.now);
    await expect(harness.runner.runOrder('order-1')).resolves.toBe('done');
    expect(harness.sent).toHaveLength(2);
  });

  it('확인 재전송도 409면 멈추고 바이트를 지운다', async () => {
    const conflict = () => json(409, { code: 'DRIVER_ORDER_STATE_CONFLICT' });
    const harness = makeHarness({ entries: [makeEntry()], responses: [conflict(), conflict()] });

    await harness.runner.runOrder('order-1');
    harness.advance(60_000);
    await expect(harness.runner.runOrder('order-1')).resolves.toBe('failed');
    const entry = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(entry.state).toBe('failed');
    expect(entry.lastFailure).toBe('STATE_CONFLICT');
    expect(entry.bytes).toBeNull();
    expect(harness.failed).toHaveLength(1);
    // 멈춘 항목은 다시 보내지 않는다.
    harness.advance(600_000);
    await expect(harness.runner.runOrder('order-1', { manual: true })).resolves.toBe('failed');
    expect(harness.sent).toHaveLength(2);
  });

  it('403 권한·404·413은 멈추고 바이트를 지운다', async () => {
    for (const [response, failure] of [
      [json(403, { code: 'DRIVER_ORDER_AUTHORITY_DENIED' }), 'AUTHORITY'],
      [json(404, { code: 'DRIVER_ORDER_NOT_FOUND' }), 'NOT_FOUND'],
      [json(413, {}), 'TOO_LARGE'],
      [json(400, {}), 'REJECTED'],
    ] as const) {
      const harness = makeHarness({ entries: [makeEntry()], responses: [response] });
      await expect(harness.runner.runOrder('order-1')).resolves.toBe('failed');
      const entry = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
      expect(entry.lastFailure).toBe(failure);
      expect(entry.bytes).toBeNull();
    }
  });

  it('12시간이 지난 항목은 보내지 않고 멈춘다', async () => {
    const harness = makeHarness({
      entries: [makeEntry({ createdAt: NOW - PENDING_PHOTO_MAX_AGE_MS })],
    });

    await harness.runner.runAll();
    const entry = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(entry.state).toBe('failed');
    expect(entry.lastFailure).toBe('EXPIRED');
    expect(entry.bytes).toBeNull();
    expect(harness.sent).toHaveLength(0);
  });

  it('판매자 ID를 모르던 항목은 실행 때 확인하고, 주문이 안 보이면 멈추고, 확인 실패면 다시 기다린다', async () => {
    const preSend = makeEntry({
      storeId: null,
      attempts: 0,
      lastAttemptAt: 0,
      lastFailure: 'OFFLINE',
    });

    const ok = makeHarness({
      entries: [preSend],
      storeIdRead: { kind: 'ok', storeId: 'store-9' },
      responses: [ack()],
    });
    await expect(ok.runner.runOrder('order-1')).resolves.toBe('done');
    expect(ok.sent[0].path).toBe('/stores/store-9/orders/order-1/delivery-photos');

    const absent = makeHarness({ entries: [preSend], storeIdRead: { kind: 'absent' } });
    await expect(absent.runner.runOrder('order-1')).resolves.toBe('failed');
    expect((absent.store.raw.get('driver-1:order-1') as PendingPhotoEntry).lastFailure).toBe(
      'NOT_FOUND',
    );
    expect(absent.sent).toHaveLength(0);

    const unknown = makeHarness({ entries: [preSend], storeIdRead: { kind: 'unknown' } });
    await expect(unknown.runner.runOrder('order-1')).resolves.toBe('retry');
    const waiting = unknown.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(waiting.lastFailure).toBe('ORDER_UNKNOWN');
    expect(waiting.state).toBe('waiting');
    expect(waiting.attempts).toBe(0);
    expect(unknown.sent).toHaveLength(0);
  });

  it('연결이 없으면 보내지 않는다', async () => {
    const harness = makeHarness({ entries: [makeEntry()], online: false });
    await expect(harness.runner.runAll()).resolves.toBeNull();
    await expect(harness.runner.runOrder('order-1')).resolves.toBe('offline');
    expect(harness.sent).toHaveLength(0);
    expect((harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry).state).toBe('waiting');
  });

  it('보내는 동안 로그아웃으로 지워진 항목은 실패 결과로 되살리지 않는다', async () => {
    let release!: (response: Response) => void;
    const harness = makeHarness({
      entries: [makeEntry()],
      responses: [() => new Promise<Response>((resolve) => (release = resolve))],
    });

    const run = harness.runner.runOrder('order-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.store.clear();
    release(json(503, {}));
    await run;
    expect(harness.store.raw.size).toBe(0);
  });

  it('"지금 올리기"는 간격을 건너뛰지만 불확실한 요청 뒤 30초는 지킨다', async () => {
    const harness = makeHarness({
      entries: [makeEntry({ lastAttemptAt: NOW - 10_000, nextAttemptAt: NOW + 200_000 })],
      responses: [ack()],
    });

    await expect(harness.runner.runOrder('order-1', { manual: true })).resolves.toBe('not-due');
    expect(harness.sent).toHaveLength(0);
    // 가장 이른 시각으로 당겨 둔다.
    expect((harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry).nextAttemptAt).toBe(
      NOW + 20_000,
    );
    harness.advance(20_000);
    await expect(harness.runner.runOrder('order-1', { manual: true })).resolves.toBe('done');
  });

  it('대기열이 비어 있으면 세션도 묻지 않는다(앱 열기·화면 복귀마다 세션 조회를 늘리지 않는다)', async () => {
    const harness = makeHarness();
    await expect(harness.runner.runAll()).resolves.toBeNull();
    expect(harness.sessionCalls).toBe(0);
    expect(harness.sent).toHaveLength(0);
  });

  it('runAll은 다음에 깨어날 시각을 돌려준다', async () => {
    const harness = makeHarness({
      entries: [makeEntry({ nextAttemptAt: NOW + 45_000 })],
    });
    await expect(harness.runner.runAll()).resolves.toBe(NOW + 45_000);
    expect(harness.sent).toHaveLength(0);
  });
});

describe('촬영 뒤 새 보류(Y3 at-most-once)', () => {
  it('항목에 남은 보류 표시를 그대로 싣고(없음은 none), 모르던 이전 항목은 싣지 않는다', async () => {
    const harness = makeHarness({
      entries: [
        makeEntry({ orderId: 'order-1', expectedHoldAt: '2026-11-13T08:00:00.000Z' }),
        makeEntry({ orderId: 'order-2', expectedHoldAt: null }),
        makeEntry({ orderId: 'order-3' }),
      ],
      responses: [ack('order-1'), ack('order-2'), ack('order-3')],
    });

    await harness.runner.runAll();

    expect(harness.sent.map((request) => request.expectedHoldAt)).toEqual([
      '2026-11-13T08:00:00.000Z',
      'none',
      null,
    ]);
  });

  it('409 DELIVERY_PHOTO_STALE_HOLD면 다시 보내지 않고 바이트를 지운 채 멈춘다', async () => {
    const harness = makeHarness({
      entries: [makeEntry({ expectedHoldAt: null })],
      responses: [
        json(409, {
          statusCode: 409,
          message: '보류',
          error: 'Conflict',
          code: 'DELIVERY_PHOTO_STALE_HOLD',
        }),
      ],
    });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('failed');
    const entry = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(entry.state).toBe('failed');
    expect(entry.lastFailure).toBe('STALE_HOLD');
    expect(entry.bytes).toBeNull();
    expect(harness.failed.map((failed) => failed.lastFailure)).toEqual(['STALE_HOLD']);

    harness.advance(10 * 60_000);
    await harness.runner.runAll({ manual: true });
    expect(harness.sent).toHaveLength(1);
  });

  it('주문 조회가 보류로 보이면 기다리는 항목을 STALE_HOLD로 멈추고 바이트를 지운다', async () => {
    const harness = makeHarness({ entries: [makeEntry({ nextAttemptAt: NOW + 60_000 })] });

    await expect(harness.runner.failStalePhoto('driver-1', 'order-1')).resolves.toBe('stale');

    const entry = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(entry.state).toBe('failed');
    expect(entry.lastFailure).toBe('STALE_HOLD');
    expect(entry.bytes).toBeNull();
    // 다른 사용자 키·없는 항목·이미 멈춘 항목은 건드리지 않는다.
    await expect(harness.runner.failStalePhoto('driver-2', 'order-1')).resolves.toBe('none');
    await expect(harness.runner.failStalePhoto('driver-1', 'order-1')).resolves.toBe('none');
    harness.advance(60_000);
    await harness.runner.runAll();
    expect(harness.sent).toHaveLength(0);
  });

  it('이 탭이 보내는 중이면 멈추지 않고, 보낸 결과(ACK)로 끝낸다', async () => {
    let release!: (response: Response) => void;
    const harness = makeHarness({
      entries: [makeEntry()],
      responses: [() => new Promise<Response>((resolve) => (release = resolve))],
    });

    const run = harness.runner.runOrder('order-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.sent).toHaveLength(1);
    await expect(harness.runner.failStalePhoto('driver-1', 'order-1')).resolves.toBe('busy');
    expect((harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry).state).toBe('sending');
    release(ack());
    await expect(run).resolves.toBe('done');
    expect(harness.store.raw.size).toBe(0);
  });

  it('다른 탭이 보내는 중(잠금 없음: 살아 있는 보내는 중 표시, 잠금 있음: 잠금을 쥠)이면 멈추지 않는다', async () => {
    const leased = makeEntry({ state: 'sending', leaseUntil: NOW + PENDING_PHOTO_LEASE_MS });
    const noLocks = makeHarness({ entries: [leased] });
    await expect(noLocks.runner.failStalePhoto('driver-1', 'order-1')).resolves.toBe('busy');
    expect((noLocks.store.raw.get('driver-1:order-1') as PendingPhotoEntry).state).toBe('sending');

    const heldElsewhere: PendingPhotoLockManager = {
      request: async (_name, _options, callback) => callback(null),
    };
    const locked = makeHarness({ entries: [makeEntry()], locks: heldElsewhere });
    await expect(locked.runner.failStalePhoto('driver-1', 'order-1')).resolves.toBe('busy');
    expect((locked.store.raw.get('driver-1:order-1') as PendingPhotoEntry).state).toBe('waiting');

    // 잠금을 쥐면 닫힌 탭이 남긴 보내는 중 표시는 흔적이므로 멈춘다.
    const free: PendingPhotoLockManager = {
      request: async (_name, _options, callback) => callback({}),
    };
    const closedTab = makeHarness({ entries: [leased], locks: free });
    await expect(closedTab.runner.failStalePhoto('driver-1', 'order-1')).resolves.toBe('stale');
  });
});

describe('보내기 직전 시도 기록(탭이 보내는 도중 닫혀도 남는다)', () => {
  it('보내는 중 표시를 쥔 뒤 보내기 전에 보낸 횟수·마지막 보낸 시각을 저장소에 먼저 쓴다', async () => {
    let release!: (response: Response) => void;
    const harness = makeHarness({
      entries: [makeEntry({ attempts: 1, lastAttemptAt: NOW - 60_000 })],
      responses: [() => new Promise<Response>((resolve) => (release = resolve))],
    });

    const run = harness.runner.runOrder('order-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 응답을 기다리는 동안(탭이 여기서 닫힐 수 있다) 저장소에 이미 이번 전송이 남아 있다.
    const inFlight = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(inFlight.state).toBe('sending');
    expect(inFlight.attempts).toBe(2);
    expect(inFlight.lastAttemptAt).toBe(NOW);

    release(json(503, {}));
    await expect(run).resolves.toBe('retry');
    // 결과 반영 때 두 번 세지 않는다.
    expect((harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry).attempts).toBe(2);
  });

  it('보내는 도중 닫힌 탭의 항목은 다음 실행이 30초 간격과 앞선 전송(409 확인 재전송)을 안다', async () => {
    // 처음 보내기 전 실패로 넣은 항목(서버가 본 적 없음)을 보내는 도중 탭이 닫혔다.
    const harness = makeHarness({
      entries: [makeEntry({ attempts: 0, lastAttemptAt: 0, lastFailure: 'OFFLINE' })],
      responses: [
        () => new Promise<Response>(() => {}),
        json(409, { code: 'DRIVER_ORDER_STATE_CONFLICT' }),
      ],
    });
    void harness.runner.runOrder('order-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const left = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    expect(left.attempts).toBe(1);

    // 닫힌 탭: 다른 실행기(새 탭)가 같은 저장소를 본다.
    const nextTab = createPendingPhotoRunner({
      ...harness.deps,
      locks: { request: async (_name, _options, callback) => callback({}) },
    });
    harness.advance(10_000);
    await expect(nextTab.runOrder('order-1', { manual: true })).resolves.toBe('not-due');
    harness.advance(20_000);
    await expect(nextTab.runOrder('order-1', { manual: true })).resolves.toBe('retry');
    const after = harness.store.raw.get('driver-1:order-1') as PendingPhotoEntry;
    // 앞서 보낸 요청이 있었으므로 409는 바로 멈추지 않고 확인 재전송을 기다린다.
    expect(after.lastFailure).toBe('CONFLICT_UNCONFIRMED');
    expect(after.state).toBe('waiting');
  });
});

describe('세션 없이도 하는 12시간 만료 정리', () => {
  it('로그아웃 상태로 앱을 열어도 12시간 지난 항목은 바이트를 지운 채 멈추고, 그 밖의 항목은 그대로 둔다', async () => {
    const harness = makeHarness({
      entries: [
        makeEntry({ orderId: 'old', createdAt: NOW - PENDING_PHOTO_MAX_AGE_MS }),
        makeEntry({
          userId: 'driver-2',
          orderId: 'old-2',
          createdAt: NOW - PENDING_PHOTO_MAX_AGE_MS,
        }),
        makeEntry({ orderId: 'fresh' }),
      ],
      sessions: [null],
    });

    await expect(harness.runner.runAll()).resolves.toBeNull();

    for (const key of ['driver-1:old', 'driver-2:old-2']) {
      const entry = harness.store.raw.get(key) as PendingPhotoEntry;
      expect(entry.state).toBe('failed');
      expect(entry.lastFailure).toBe('EXPIRED');
      expect(entry.bytes).toBeNull();
    }
    const fresh = harness.store.raw.get('driver-1:fresh') as PendingPhotoEntry;
    expect(fresh.state).toBe('waiting');
    expect(fresh.bytes).not.toBeNull();
    expect(harness.sent).toHaveLength(0);
  });
});

describe('메모리 저장소', () => {
  it('깨진 항목은 읽을 때 버리고 지운다', async () => {
    const store = createMemoryPendingPhotoStore([
      ['driver-1:order-1', makeEntry()],
      ['driver-1:order-2', { v: 1, userId: 'driver-1' }],
      ['driver-1:order-3', makeEntry({ orderId: 'order-9' })],
    ]);
    const entries = await store.list();
    expect(entries.map((entry) => entry.orderId)).toEqual(['order-1']);
    expect([...store.raw.keys()]).toEqual(['driver-1:order-1']);
  });

  it('update는 있을 때만 바꾸고 형식이 맞지 않는 결과는 쓰지 않는다', async () => {
    const store = createMemoryPendingPhotoStore();
    await expect(store.update('driver-1:order-1', (current) => current)).resolves.toBeNull();
    expect(store.raw.size).toBe(0);
    await expect(store.put(makeEntry())).resolves.toBe(true);
    await expect(
      store.update('driver-1:order-1', (current) => ({ ...current, bytes: null })),
    ).resolves.toBeNull();
    expect((store.raw.get('driver-1:order-1') as PendingPhotoEntry).bytes).not.toBeNull();
    await expect(store.put({ ...makeEntry(), idempotencyKey: 'x' })).resolves.toBe(false);
  });
});

describe('회차 직배송 사진 보내기(화면·대기열 공용)', () => {
  const photo = new Blob([photoBytes()], { type: 'image/jpeg' });
  const send = (response: Response | Error) =>
    sendRoundDirectPhoto({
      post: async () => {
        if (response instanceof Error) throw response;
        return response;
      },
      token: 'token-1',
      storeId: 'store-1',
      orderId: 'order-1',
      idempotencyKey: KEY,
      photo,
    });

  it('같은 주문·photoId·DELIVERED ACK만 성공이다', async () => {
    await expect(send(ack())).resolves.toEqual({ kind: 'ack' });
    await expect(send(ack('order-other'))).resolves.toEqual({
      kind: 'failure',
      failure: 'ACK_UNCONFIRMED',
      status: 200,
    });
    await expect(send(new Response('not-json', { status: 200 }))).resolves.toMatchObject({
      failure: 'ACK_UNCONFIRMED',
    });
  });

  it('실패를 불확실·확정 거절로 나누고 HTTP 상태를 함께 돌려준다', async () => {
    await expect(send(new TypeError('Failed to fetch'))).resolves.toEqual({
      kind: 'failure',
      failure: 'NETWORK',
      status: null,
    });
    await expect(send(new ApiTimeoutError(90_000))).resolves.toMatchObject({ failure: 'NETWORK' });
    await expect(send(json(502, {}))).resolves.toMatchObject({ failure: 'SERVER', status: 502 });
    await expect(send(json(429, {}))).resolves.toMatchObject({ failure: 'SERVER' });
    await expect(send(json(401, {}))).resolves.toMatchObject({ failure: 'AUTHORITY', status: 401 });
    await expect(send(json(409, { code: 'DRIVER_ORDER_STATE_CONFLICT' }))).resolves.toMatchObject({
      failure: 'STATE_CONFLICT',
      status: 409,
    });
  });

  it('경로에 넣을 수 없는 판매자 ID면 보내지 않는다', async () => {
    let called = false;
    await expect(
      sendRoundDirectPhoto({
        post: async () => {
          called = true;
          return ack();
        },
        token: 'token-1',
        storeId: '../store',
        orderId: 'order-1',
        idempotencyKey: KEY,
        photo,
      }),
    ).resolves.toEqual({ kind: 'failure', failure: 'REJECTED', status: null });
    expect(called).toBe(false);
  });
});

describe('회차 직배송 사진 보내기: 촬영 뒤 새 보류', () => {
  it('409 DELIVERY_PHOTO_STALE_HOLD는 STALE_HOLD 확정 거절이고, 보류 표시를 준 대로 싣는다', async () => {
    const forms: FormData[] = [];
    const result = await sendRoundDirectPhoto({
      post: async (_path, _token, init) => {
        forms.push(init.body);
        return json(409, { statusCode: 409, code: 'DELIVERY_PHOTO_STALE_HOLD' });
      },
      token: 'token-1',
      storeId: 'store-1',
      orderId: 'order-1',
      idempotencyKey: KEY,
      photo: new Blob([photoBytes()], { type: 'image/jpeg' }),
      expectedHoldAt: '2026-11-13T08:00:00.000Z',
    });

    expect(result).toEqual({ kind: 'failure', failure: 'STALE_HOLD', status: 409 });
    expect(forms[0].get('expectedHoldAt')).toBe('2026-11-13T08:00:00.000Z');
  });
});

describe('자동 업로드 완료 알림의 주소 표시(S-08)', () => {
  it('항목에 남긴 동·호수를 완료 항목으로 넘기고, 항목을 지우면 주소 표시도 함께 지워진다', async () => {
    const harness = makeHarness({
      entries: [makeEntry({ addressLabel: '101동 1203호' })],
      responses: [ack()],
    });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('done');

    expect(harness.completed).toHaveLength(1);
    expect(harness.completed[0]?.addressLabel).toBe('101동 1203호');
    expect(pendingPhotoCompletedMessage(harness.completed[0] as PendingPhotoEntry)).toBe(
      '101동 1203호 배송을 완료했어요(사진 올림).',
    );
    expect(harness.store.raw.size).toBe(0);
  });

  it('주소 표시가 없는 이전 항목도 그대로 올리고 예전 완료 문구를 쓴다', async () => {
    const harness = makeHarness({ entries: [makeEntry()], responses: [ack()] });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('done');

    expect(harness.completed[0] && 'addressLabel' in harness.completed[0]).toBe(false);
    expect(pendingPhotoCompletedMessage(harness.completed[0] as PendingPhotoEntry)).toBe(
      PENDING_PHOTO_MESSAGES.COMPLETED,
    );
  });

  it('재시도로 다시 쓴 항목에도 주소 표시가 남는다', async () => {
    const harness = makeHarness({
      entries: [makeEntry({ addressLabel: '101동 1203호' })],
      responses: [json(503, {})],
    });

    await expect(harness.runner.runOrder('order-1')).resolves.toBe('retry');

    const stored = await harness.store.get(pendingPhotoKey('driver-1', 'order-1'));
    expect(stored?.addressLabel).toBe('101동 1203호');
  });
});
