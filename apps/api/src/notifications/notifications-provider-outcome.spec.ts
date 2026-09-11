import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AligoClient } from './aligo.client';
import {
  NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS,
  NotificationsService,
} from './notifications.service';

type Data = Record<string, unknown>;

const phone = '01012345678';
const templateCode = 'ORDER_DELIVERY_HELD';
const variables = { orderId: 'order-1', reason: '연락 불가' };

const configured = {
  ALIGO_API_KEY: 'test-api-key',
  ALIGO_USER_ID: 'test-user',
  ALIGO_SENDER_KEY: 'test-sender-key',
  ALIGO_SENDER_PHONE: '0212345678',
  ALIGO_TEMPLATE_CODES_JSON: JSON.stringify({ [templateCode]: 'provider-delivery-held' }),
};

function makeClient(config: Data = {}) {
  const configService = {
    get: jest.fn((key: string, fallback: string) => config[key] ?? fallback),
  } as unknown as ConfigService;
  return new AligoClient(configService);
}

function alimtalkOk(mid: string) {
  return { json: jest.fn().mockResolvedValue({ code: 0, message: '성공', info: { mid } }) };
}

function alimtalkReject(code = -1, message = '일시 오류') {
  return { json: jest.fn().mockResolvedValue({ code, message }) };
}

function smsOk(msgId: string) {
  return {
    json: jest.fn().mockResolvedValue({ result_code: 1, message: '성공', msg_id: msgId }),
  };
}

// ── service harness ──

function deliveryDocId(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function deliveryPath(key: string): string {
  return `notificationDeliveries/${deliveryDocId(key)}`;
}

const BASE_NOW = Date.UTC(2026, 8, 11, 0, 0, 0);

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Data).map(([k, v]) => [k, clone(v)]),
    ) as T;
  }
  return value;
}

function makeServiceHarness(opts: {
  aligoImpl?: Data;
  failFinishWithStatus?: string | null;
} = {}) {
  const records = new Map<string, Data>();
  records.set('users/user-1', { id: 'user-1', phone: '01011112222' });
  records.set('orders/order-1', {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'user-1',
    status: 'DELIVERY_HELD',
    deliveryPhone: phone,
  });
  let nowMillis = BASE_NOW;
  let transactionQueue = Promise.resolve();
  let runTxCount = 0;

  function snapshot(path: string, source: Map<string, Data>) {
    const data = source.get(path);
    return {
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : clone(data)),
    };
  }

  function doc(path: string) {
    return {
      path,
      get: jest.fn(async () => snapshot(path, records)),
      set: jest.fn(async (data: Data, options?: { merge?: boolean }) => {
        const current = records.get(path);
        const next = options?.merge && current ? { ...clone(current), ...clone(data) } : clone(data);
        records.set(path, next);
      }),
      update: jest.fn(async (data: Data) => {
        const current = records.get(path);
        if (!current) throw new Error(`missing doc: ${path}`);
        records.set(path, { ...clone(current), ...clone(data) });
      }),
    };
  }

  const firestore = {
    doc,
    runTransaction: jest.fn((callback: (tx: any) => Promise<unknown>) => {
      runTxCount += 1;
      const callIndex = runTxCount;
      const result = transactionQueue.then(async () => {
        const staged = new Map<string, Data>(
          Array.from(records.entries()).map(([p, d]) => [p, clone(d)]),
        );
        const transaction = {
          get: jest.fn(async (ref: { path: string }) => snapshot(ref.path, staged)),
          set: jest.fn((ref: { path: string }, data: Data, options?: { merge?: boolean }) => {
            if (
              opts.failFinishWithStatus &&
              typeof data?.['status'] === 'string' &&
              data['status'] === opts.failFinishWithStatus &&
              callIndex >= 3
            ) {
              throw new Error(`injected finalize failure for ${data['status']}`);
            }
            const current = staged.get(ref.path);
            const next =
              options?.merge && current ? { ...clone(current), ...clone(data) } : clone(data);
            staged.set(ref.path, next);
          }),
          update: jest.fn((ref: { path: string }, data: Data) => {
            const current = staged.get(ref.path);
            if (!current) throw new Error(`missing doc: ${ref.path}`);
            staged.set(ref.path, { ...clone(current), ...clone(data) });
          }),
        };
        const value = await callback(transaction);
        records.clear();
        for (const [p, d] of staged) records.set(p, d);
        return value;
      });
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date(nowMillis)),
      fromDate: jest.fn((date: Date) => new Date(date.getTime())),
    },
  };

  const defaultAligo = {
    success: true,
    outcome: 'ACCEPTED',
    channel: 'alimtalk',
    message: 'ok',
    alimtalkAttempts: 1,
    smsAttempts: 0,
    providerReceipt: 'DEFAULT-MID',
    attemptId: 'default-attempt-1',
    needsVerify: false,
  };
  const aligo = {
    sendAlimtalk: jest.fn().mockResolvedValue({ ...defaultAligo, ...(opts.aligoImpl ?? {}) }),
    sendSms: jest.fn().mockResolvedValue({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'sms',
      message: 'ok-sms',
      alimtalkAttempts: 0,
      smsAttempts: 1,
      providerReceipt: 'DEFAULT-SMS-ID',
      attemptId: 'default-sms-attempt-1',
      needsVerify: false,
    }),
  };
  const issueWriter = { createOrMergeIssue: jest.fn(async (issue: Data) => issue) };
  const service = new (NotificationsService as any)(firestore, aligo, {}, issueWriter) as any;

  return {
    service: service as NotificationsService,
    records,
    firestore,
    aligo,
    issueWriter,
    readDelivery: (key: string) => clone(records.get(deliveryPath(key))),
    readNotifications: () =>
      Array.from(records.entries())
        .filter(([p]) => p.startsWith('notifications/'))
        .map(([, d]) => clone(d)),
    advance: (ms: number) => {
      nowMillis += ms;
    },
  };
}

describe('provider outcome contract (AligoClient)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('CASE 1: alimtalk code=0 + info.mid는 ACCEPTED + receipt 보존, SMS fallback 0', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(alimtalkOk('MID-KNOWN-001'));
    const client = makeClient(configured);
    const result = await client.sendAlimtalk(phone, templateCode, variables);
    expect(result).toMatchObject({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'alimtalk',
      alimtalkAttempts: 1,
      smsAttempts: 0,
      providerReceipt: 'MID-KNOWN-001',
      needsVerify: false,
    });
    expect(typeof result.attemptId).toBe('string');
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('CASE 2: SMS result_code=1 + msg_id는 ACCEPTED + receipt 보존', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(smsOk('MSGID-KNOWN-002'));
    const client = makeClient(configured);
    const result = await client.sendSms(phone, templateCode, variables);
    expect(result).toMatchObject({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'sms',
      smsAttempts: 1,
      providerReceipt: 'MSGID-KNOWN-002',
      needsVerify: false,
    });
  });

  it('CASE 2b: alimtalk 3회 REJECTED 뒤 SMS ACCEPTED는 sms receipt를 보존한다', async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce(alimtalkReject(-1, '실패1'))
      .mockResolvedValueOnce(alimtalkReject(-1, '실패2'))
      .mockResolvedValueOnce(alimtalkReject(-1, '실패3'))
      .mockResolvedValueOnce(smsOk('MSGID-FALLBACK-003'));
    const client = makeClient(configured);
    const result = await client.sendAlimtalk(phone, templateCode, variables);
    expect(result).toMatchObject({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'sms',
      alimtalkAttempts: 3,
      smsAttempts: 1,
      providerReceipt: 'MSGID-FALLBACK-003',
    });
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(4);
  });

  it('CASE 3: 첫 alimtalk throw는 UNKNOWN, retry 0, SMS fallback 0, FAILED 아님', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    const client = makeClient(configured);
    const result = await client.sendAlimtalk(phone, templateCode, variables);
    expect(result).toMatchObject({
      success: false,
      outcome: 'UNKNOWN',
      channel: null,
      alimtalkAttempts: 1,
      smsAttempts: 0,
      providerReceipt: null,
      needsVerify: true,
    });
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('CASE 3b: 응답 파싱 실패도 UNKNOWN으로 분류한다', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockRejectedValue(new Error('bad json')),
    });
    const client = makeClient(configured);
    const result = await client.sendAlimtalk(phone, templateCode, variables);
    expect(result.outcome).toBe('UNKNOWN');
    expect(result.needsVerify).toBe(true);
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('CASE 4: 명시적 실패 코드는 REJECTED이며 기존 범위에서 retry/fallback한다', async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce(alimtalkReject(-1, '일시 오류'))
      .mockResolvedValueOnce(alimtalkReject(-1, '일시 오류'))
      .mockResolvedValueOnce(alimtalkOk('MID-RETRY-OK'));
    const client = makeClient(configured);
    const result = await client.sendAlimtalk(phone, templateCode, variables);
    expect(result).toMatchObject({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'alimtalk',
      alimtalkAttempts: 3,
      smsAttempts: 0,
      providerReceipt: 'MID-RETRY-OK',
    });
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(3);
  });
});

describe('delivery outcome reconciliation (NotificationsService)', () => {
  it('CASE 1 (service): ACCEPTED는 SENT + receipt + attempt 연결, SMS 0, 이슘 0', async () => {
    const h = makeServiceHarness({
      aligoImpl: {
        success: true,
        outcome: 'ACCEPTED',
        channel: 'alimtalk',
        message: '보류 본문',
        alimtalkAttempts: 1,
        smsAttempts: 0,
        providerReceipt: 'MID-KNOWN-001',
        attemptId: 'attempt-001',
        needsVerify: false,
      },
    });
    const key = 'outcome-case1-accepted';
    await (h.service as any).sendToUser('user-1', templateCode, variables, 'order-1', key);

    const delivery = h.readDelivery(key) as Data;
    expect(delivery).toMatchObject({
      status: 'SENT',
      lastAttemptId: 'attempt-001',
      providerReceipt: 'MID-KNOWN-001',
      lastOutcome: 'ACCEPTED',
      needsVerify: false,
    });
    const notifs = h.readNotifications();
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      status: 'sent',
      attemptId: 'attempt-001',
      providerReceipt: 'MID-KNOWN-001',
      providerOutcome: 'ACCEPTED',
      idempotencyKey: key,
    });
    expect(h.aligo.sendSms).not.toHaveBeenCalled();
    expect(h.issueWriter.createOrMergeIssue).not.toHaveBeenCalled();
  });

  it('SENT는 provider-accepted terminal이다 (단말 DELIVERED와 동일하지 않음)', async () => {
    const h = makeServiceHarness({
      aligoImpl: {
        success: true,
        outcome: 'ACCEPTED',
        channel: 'alimtalk',
        message: 'ok',
        alimtalkAttempts: 1,
        smsAttempts: 0,
        providerReceipt: 'MID-TERM-001',
        attemptId: 'attempt-term-1',
        needsVerify: false,
      },
    });
    const key = 'outcome-sent-terminal-proof';
    await (h.service as any).sendToUser('user-1', templateCode, variables, 'order-1', key);
    expect(h.readDelivery(key)).toMatchObject({ status: 'SENT', lastOutcome: 'ACCEPTED' });
    const retry = await (h.service as any).claimNotificationDelivery({
      idempotencyKey: key,
      orderId: 'order-1',
      templateCode,
      userId: 'user-1',
    });
    expect(retry).toBeNull();
  });

  it('CASE 3 (service): UNKNOWN은 NEEDS_VERIFY, retry/fallback 0, FAILED 아님', async () => {
    const h = makeServiceHarness({
      aligoImpl: {
        success: false,
        outcome: 'UNKNOWN',
        channel: null,
        message: '보류 본문',
        alimtalkAttempts: 1,
        smsAttempts: 0,
        providerReceipt: null,
        attemptId: 'attempt-unknown-1',
        needsVerify: true,
        errorMessage: 'transport 불확실',
      },
    });
    const key = 'outcome-case3-unknown';
    await (h.service as any).sendToUser('user-1', templateCode, variables, 'order-1', key);

    const delivery = h.readDelivery(key) as Data;
    expect(delivery['status']).toBe('NEEDS_VERIFY');
    expect(delivery).toMatchObject({
      lastAttemptId: 'attempt-unknown-1',
      providerReceipt: null,
      lastOutcome: 'UNKNOWN',
      needsVerify: true,
    });
    expect(delivery['status']).not.toBe('FAILED');
    const notifs = h.readNotifications();
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ status: 'pending', providerOutcome: 'UNKNOWN' });
    expect(h.aligo.sendSms).not.toHaveBeenCalled();
    expect(h.issueWriter.createOrMergeIssue).not.toHaveBeenCalled();

    h.advance(NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS + 1);
    const reclaim = await (h.service as any).claimNotificationDelivery({
      idempotencyKey: key,
      orderId: 'order-1',
      templateCode,
      userId: 'user-1',
    });
    expect(reclaim).toBeNull();
  });

  it('CASE 4 (service): REJECTED만 FAILED retryable이며 이슈를 만든다', async () => {
    const h = makeServiceHarness({
      aligoImpl: {
        success: false,
        outcome: 'REJECTED',
        channel: null,
        message: '보류 본문',
        alimtalkAttempts: 3,
        smsAttempts: 1,
        providerReceipt: null,
        attemptId: 'attempt-rejected-1',
        needsVerify: false,
        errorMessage: '명시적 거부',
      },
    });
    const key = 'outcome-case4-rejected';
    await (h.service as any).sendToUser('user-1', templateCode, variables, 'order-1', key);
    expect(h.readDelivery(key)).toMatchObject({ status: 'FAILED', lastOutcome: 'REJECTED' });
    expect(h.issueWriter.createOrMergeIssue).toHaveBeenCalledTimes(1);

    const retry = await (h.service as any).claimNotificationDelivery({
      idempotencyKey: key,
      orderId: 'order-1',
      templateCode,
      userId: 'user-1',
    });
    expect(typeof retry).toBe('string');
  });

  it('CASE 5: ACCEPTED 후 finalize 실패는 FAILED로 붕괴하지 않고 reclaim blind resend 금지', async () => {
    const h = makeServiceHarness({
      aligoImpl: {
        success: true,
        outcome: 'ACCEPTED',
        channel: 'alimtalk',
        message: '보류 본문',
        alimtalkAttempts: 1,
        smsAttempts: 0,
        providerReceipt: 'MID-CASE5-001',
        attemptId: 'attempt-case5-1',
        needsVerify: false,
      },
      failFinishWithStatus: 'SENT',
    });
    const key = 'outcome-case5-finalize-fail';
    await expect(
      (h.service as any).sendToUser('user-1', templateCode, variables, 'order-1', key),
    ).rejects.toThrow();
    const delivery = h.readDelivery(key) as Data;
    expect(delivery['status']).not.toBe('FAILED');
    expect(delivery).toMatchObject({
      providerReceipt: 'MID-CASE5-001',
      lastAttemptId: 'attempt-case5-1',
      lastOutcome: 'ACCEPTED',
    });
    h.advance(NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS + 1);
    const reclaim = await (h.service as any).claimNotificationDelivery({
      idempotencyKey: key,
      orderId: 'order-1',
      templateCode,
      userId: 'user-1',
    });
    expect(reclaim).toBeNull();
    h.aligo.sendAlimtalk.mockClear();
    await (h.service as any).sendToUser('user-1', templateCode, variables, 'order-1', key);
    expect(h.aligo.sendAlimtalk).not.toHaveBeenCalled();
  });

  it('CASE 6: stale owner ACCEPTED는 DB owner를 덮지 못하고 시도는 관찰 가능하다', async () => {
    const h = makeServiceHarness();
    const key = 'outcome-case6-stale';
    const stale = await (h.service as any).claimNotificationDelivery({
      idempotencyKey: key,
      orderId: 'order-1',
      templateCode,
      userId: 'user-1',
    });
    h.advance(NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS + 1);
    const current = await (h.service as any).claimNotificationDelivery({
      idempotencyKey: key,
      orderId: 'order-1',
      templateCode,
      userId: 'user-1',
    });
    expect(current).not.toBe(stale);

    const recorded = await (h.service as any).recordDeliveryAttempt(key, stale, {
      outcome: 'ACCEPTED',
      providerReceipt: 'MID-STALE-001',
      attemptId: 'attempt-stale-1',
    });
    expect(recorded).toBe(false);
    await (h.service as any).finishNotificationDelivery(key, 'SENT', stale, {
      outcome: 'ACCEPTED',
      providerReceipt: 'MID-STALE-001',
      attemptId: 'attempt-stale-1',
    });
    expect(h.readDelivery(key)).toMatchObject({ status: 'PROCESSING', leaseId: current });

    await (h.service as any).finishNotificationDelivery(key, 'SENT', current, {
      outcome: 'ACCEPTED',
      providerReceipt: 'MID-CURRENT-001',
      attemptId: 'attempt-current-1',
    });
    expect(h.readDelivery(key)).toMatchObject({
      status: 'SENT',
      leaseId: current,
      providerReceipt: 'MID-CURRENT-001',
    });
  });

  it('manual resend는 원본 연결 + 새 attempt + receipt를 남기고 UNKNOWN을 무조건 재시도하지 않는다', async () => {
    const h = makeServiceHarness();
    h.records.set('notifications/origin-1', {
      id: 'origin-1',
      userId: 'user-1',
      orderId: 'order-1',
      channel: 'alimtalk',
      templateCode,
      variables,
      message: '원본',
      phone,
      status: 'failed',
      attemptId: 'attempt-origin-1',
      providerReceipt: null,
      providerOutcome: 'REJECTED',
      idempotencyKey: 'outcome-resend-origin-key',
    });
    const issue = { latestSnapshot: { notificationId: 'origin-1' } };

    h.aligo.sendSms.mockResolvedValueOnce({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'sms',
      message: '재발송 본문',
      alimtalkAttempts: 0,
      smsAttempts: 1,
      providerReceipt: 'MSGID-RESEND-001',
      attemptId: 'attempt-resend-1',
      needsVerify: false,
    });
    const result = await (h.service as any).resendSms(issue);
    expect(result).toMatchObject({ outcome: 'ACCEPTED', providerReceipt: 'MSGID-RESEND-001' });
    const notifs = h.readNotifications();
    const resend = notifs.find((n) => (n as Data)['resendOfNotificationId'] === 'origin-1') as Data;
    expect(resend).toMatchObject({
      attemptId: 'attempt-resend-1',
      providerReceipt: 'MSGID-RESEND-001',
      providerOutcome: 'ACCEPTED',
      idempotencyKey: 'outcome-resend-origin-key',
    });
    expect(h.aligo.sendSms).toHaveBeenCalledTimes(1);

    h.aligo.sendSms.mockResolvedValueOnce({
      success: false,
      outcome: 'UNKNOWN',
      channel: null,
      message: '재발송 본문',
      alimtalkAttempts: 0,
      smsAttempts: 1,
      providerReceipt: null,
      attemptId: 'attempt-resend-unknown-1',
      needsVerify: true,
      errorMessage: 'transport 불확실',
    });
    await expect((h.service as any).resendSms(issue)).rejects.toThrow();
    expect(h.aligo.sendSms).toHaveBeenCalledTimes(2);
    const unknowns = h
      .readNotifications()
      .filter((n) => (n as Data)['attemptId'] === 'attempt-resend-unknown-1');
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0]).toMatchObject({ status: 'pending', providerOutcome: 'UNKNOWN' });
  });
});
