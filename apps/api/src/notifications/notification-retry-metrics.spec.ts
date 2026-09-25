import type { ConfigService } from '@nestjs/config';
import {
  AligoClient,
  computeNotificationRetryDelayMs,
  NOTIFICATION_RETRY_BACKOFF_POLICY,
  type ProviderErrorClass,
} from './aligo.client';
import {
  type NotificationRetryMetricsChannel,
  NotificationRetryMetricsRecorder,
} from './notification-retry-metrics';
import { renderNotificationMessage } from './notification-templates';

type Data = Record<string, unknown>;

const phone = '01098765432';
const templateCode = 'ORDER_DELIVERY_HELD';
const variables = { orderId: 'ORDER-PII-9911', reason: 'PII-REASON-9911' };

const configured = {
  ALIGO_API_KEY: 'test-api-key',
  ALIGO_USER_ID: 'test-user',
  ALIGO_SENDER_KEY: 'test-sender-key',
  ALIGO_SENDER_PHONE: '0212345678',
  ALIGO_TEMPLATE_CODES_JSON: JSON.stringify({ [templateCode]: 'provider-delivery-held' }),
};

const zeroCounts = { RATE_LIMITED: 0, RETRYABLE: 0, PERMANENT: 0, UNKNOWN: 0 };
const zeroDelay = { count: 0, totalMs: 0, minMs: null, maxMs: null, lastMs: null };

function emptySnapshot() {
  return {
    channels: {
      alimtalk: { errorClassCounts: { ...zeroCounts }, appliedRetryDelay: { ...zeroDelay } },
      sms: { errorClassCounts: { ...zeroCounts }, appliedRetryDelay: { ...zeroDelay } },
    },
  };
}

function makeConfig(config: Data = configured) {
  return {
    get: jest.fn((key: string, fallback: string) => config[key] ?? fallback),
  } as unknown as ConfigService;
}

function makeClient(config: Data = configured, metrics = new NotificationRetryMetricsRecorder()) {
  return { client: new AligoClient(makeConfig(config), metrics), metrics };
}

function response(code: number, message = '오류', status?: number) {
  return {
    status,
    json: jest.fn().mockResolvedValue({ code, message }),
  } as unknown as Response;
}

describe('NotificationRetryMetricsRecorder 단위 계약', () => {
  it('채널별 분류 counter와 적용 지연 집계를 기록·노출한다', () => {
    const recorder = new NotificationRetryMetricsRecorder();
    recorder.recordProviderErrorClassification('alimtalk', 'RATE_LIMITED');
    recorder.recordProviderErrorClassification('alimtalk', 'RATE_LIMITED');
    recorder.recordProviderErrorClassification('alimtalk', 'UNKNOWN');
    recorder.recordProviderErrorClassification('sms', 'PERMANENT');
    recorder.recordAppliedRetryDelay('alimtalk', 1000);
    recorder.recordAppliedRetryDelay('alimtalk', 2000);
    recorder.recordAppliedRetryDelay('sms', 50);

    expect(recorder.snapshot()).toEqual({
      channels: {
        alimtalk: {
          errorClassCounts: { RATE_LIMITED: 2, RETRYABLE: 0, PERMANENT: 0, UNKNOWN: 1 },
          appliedRetryDelay: { count: 2, totalMs: 3000, minMs: 1000, maxMs: 2000, lastMs: 2000 },
        },
        sms: {
          errorClassCounts: { RATE_LIMITED: 0, RETRYABLE: 0, PERMANENT: 1, UNKNOWN: 0 },
          appliedRetryDelay: { count: 1, totalMs: 50, minMs: 50, maxMs: 50, lastMs: 50 },
        },
      },
    });
  });

  it('알 수 없는 채널·값 입력은 예외 없이 무시한다', () => {
    const recorder = new NotificationRetryMetricsRecorder();

    expect(() => {
      recorder.recordProviderErrorClassification(
        'push' as unknown as NotificationRetryMetricsChannel,
        'RETRYABLE',
      );
      recorder.recordProviderErrorClassification(
        'alimtalk',
        'CRASHED' as unknown as ProviderErrorClass,
      );
      recorder.recordAppliedRetryDelay('alimtalk', Number.NaN);
      recorder.recordAppliedRetryDelay('alimtalk', -1);
      recorder.recordAppliedRetryDelay('sms', Number.POSITIVE_INFINITY);
      recorder.recordAppliedRetryDelay('push' as unknown as NotificationRetryMetricsChannel, 100);
    }).not.toThrow();

    expect(recorder.snapshot()).toEqual(emptySnapshot());
  });

  it('snapshot은 독립 복제본을 반환한다', () => {
    const recorder = new NotificationRetryMetricsRecorder();
    const before = recorder.snapshot();
    recorder.recordProviderErrorClassification('alimtalk', 'RETRYABLE');
    recorder.recordAppliedRetryDelay('alimtalk', 200);

    expect(before).toEqual(emptySnapshot());
    before.channels.alimtalk.errorClassCounts.RETRYABLE += 999;
    before.channels.alimtalk.appliedRetryDelay.count += 999;

    expect(recorder.snapshot()).toEqual({
      channels: {
        alimtalk: {
          errorClassCounts: { ...zeroCounts, RETRYABLE: 1 },
          appliedRetryDelay: {
            ...zeroDelay,
            count: 1,
            totalMs: 200,
            minMs: 200,
            maxMs: 200,
            lastMs: 200,
          },
        },
        sms: { errorClassCounts: { ...zeroCounts }, appliedRetryDelay: { ...zeroDelay } },
      },
    });
  });
});

describe('NOTIFICATION_RETRY_METRICS — provider 오류 분류 counter', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('알림톡 일시 오류는 alimtalk RETRYABLE로 기록하고 SMS 채널은 0으로 남긴다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(0));

    const { client, metrics } = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({
      success: true,
      channel: 'alimtalk',
      alimtalkAttempts: 3,
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.channels.alimtalk.errorClassCounts).toEqual({ ...zeroCounts, RETRYABLE: 2 });
    expect(snapshot.channels.sms.errorClassCounts).toEqual(zeroCounts);
  });

  it('알림톡 rate-limit 오류는 alimtalk RATE_LIMITED로 기록한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '초당 발송 한도를 초과했습니다'))
      .mockResolvedValueOnce(response(-1, '초당 발송 한도를 초과했습니다'))
      .mockResolvedValueOnce(response(0));

    const { client, metrics } = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ success: true, channel: 'alimtalk' });

    expect(metrics.snapshot().channels.alimtalk.errorClassCounts).toEqual({
      ...zeroCounts,
      RATE_LIMITED: 2,
    });
  });

  it('명시적 영구 오류는 alimtalk PERMANENT 1회로 기록하고 SMS 성공은 기록하지 않는다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(400, '잘못된 요청입니다'))
      .mockResolvedValueOnce(response(0));

    const { client, metrics } = makeClient();
    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: true,
      channel: 'sms',
      alimtalkAttempts: 1,
      smsAttempts: 1,
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.channels.alimtalk.errorClassCounts).toEqual({ ...zeroCounts, PERMANENT: 1 });
    expect(snapshot.channels.alimtalk.appliedRetryDelay).toEqual(zeroDelay);
    expect(snapshot.channels.sms.errorClassCounts).toEqual(zeroCounts);
  });

  it('transport 불확실은 alimtalk UNKNOWN 1회로 기록하고 SMS 시도를 남기지 않는다', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));

    const { client, metrics } = makeClient();
    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      outcome: 'UNKNOWN',
      needsVerify: true,
      smsAttempts: 0,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const snapshot = metrics.snapshot();
    expect(snapshot.channels.alimtalk.errorClassCounts).toEqual({ ...zeroCounts, UNKNOWN: 1 });
    expect(snapshot.channels.sms.errorClassCounts).toEqual(zeroCounts);
  });

  it('SMS fallback 실패는 sms 채널 분류로 기록한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(-1, '초당 발송 한도를 초과했습니다'));

    const { client, metrics } = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({
      success: false,
      outcome: 'REJECTED',
      alimtalkAttempts: 3,
      smsAttempts: 1,
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.channels.alimtalk.errorClassCounts).toEqual({ ...zeroCounts, RETRYABLE: 3 });
    expect(snapshot.channels.sms.errorClassCounts).toEqual({ ...zeroCounts, RATE_LIMITED: 1 });
  });

  it('직접 SMS rate-limit 응답은 sms RATE_LIMITED로 기록한다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(-1, '초당 발송 한도를 초과했습니다'));

    const { client, metrics } = makeClient();
    await expect(client.sendSms(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      outcome: 'REJECTED',
      errorClass: 'RATE_LIMITED',
      smsAttempts: 1,
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.channels.sms.errorClassCounts).toEqual({ ...zeroCounts, RATE_LIMITED: 1 });
    expect(snapshot.channels.alimtalk.errorClassCounts).toEqual(zeroCounts);
  });

  it('직접 SMS transport 불확실은 sms UNKNOWN으로 기록한다', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));

    const { client, metrics } = makeClient();
    await expect(client.sendSms(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      outcome: 'UNKNOWN',
      needsVerify: true,
    });

    expect(metrics.snapshot().channels.sms.errorClassCounts).toEqual({
      ...zeroCounts,
      UNKNOWN: 1,
    });
  });

  it('설정 누락 fail-closed 전달은 관측 기록을 남기지 않는다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(0));

    const { client, metrics } = makeClient({});
    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      alimtalkAttempts: 0,
      smsAttempts: 0,
    });
    expect(global.fetch).not.toHaveBeenCalled();

    expect(metrics.snapshot()).toEqual(emptySnapshot());
  });
});

describe('NOTIFICATION_RETRY_METRICS — 재시도 사이 적용 지연', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('일시 오류 재시도에 적용된 backoff 지연을 계산값 그대로 기록한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(0));

    const { client, metrics } = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ success: true, alimtalkAttempts: 3 });

    const first = computeNotificationRetryDelayMs('RETRYABLE', 0);
    const second = computeNotificationRetryDelayMs('RETRYABLE', 1);
    expect(metrics.snapshot().channels.alimtalk.appliedRetryDelay).toEqual({
      count: 2,
      totalMs: first + second,
      minMs: first,
      maxMs: second,
      lastMs: second,
    });
    expect(metrics.snapshot().channels.sms.appliedRetryDelay).toEqual(zeroDelay);
  });

  it('rate-limit 지연은 별도 base와 maxBackoffMs 상한 값으로 기록된다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '발송 요청 제한 초과'))
      .mockResolvedValueOnce(response(-1, '발송 요청 제한 초과'))
      .mockResolvedValueOnce(response(-1, '발송 요청 제한 초과'))
      .mockResolvedValueOnce(response(0));

    const { client, metrics } = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({
      success: true,
      channel: 'sms',
      alimtalkAttempts: 3,
      smsAttempts: 1,
    });

    const first = computeNotificationRetryDelayMs('RATE_LIMITED', 0);
    const second = computeNotificationRetryDelayMs('RATE_LIMITED', 1);
    expect(second).toBe(NOTIFICATION_RETRY_BACKOFF_POLICY.maxBackoffMs);
    expect(metrics.snapshot().channels.alimtalk.appliedRetryDelay).toEqual({
      count: 2,
      totalMs: first + second,
      minMs: first,
      maxMs: second,
      lastMs: second,
    });
  });
});

describe('NOTIFICATION_RETRY_METRICS — PII 미기록', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('관측 기록에 전화번호·본문 변수·receipt·템플릿 코드를 기록하지 않는다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '초당 발송 한도를 초과했습니다'))
      .mockResolvedValueOnce({
        status: 200,
        json: jest.fn().mockResolvedValue({ code: 0, info: { mid: 'RECEIPT-PII-9911' } }),
      } as unknown as Response);

    const { client, metrics } = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({
      success: true,
      channel: 'alimtalk',
      providerReceipt: 'RECEIPT-PII-9911',
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.channels.alimtalk.errorClassCounts).toEqual({ ...zeroCounts, RATE_LIMITED: 1 });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(phone);
    expect(serialized).not.toContain(variables.orderId);
    expect(serialized).not.toContain(variables.reason);
    expect(serialized).not.toContain('RECEIPT-PII-9911');
    expect(serialized).not.toContain(templateCode);
    expect(serialized).not.toContain('provider-delivery-held');

    expect(Object.keys(snapshot.channels).sort()).toEqual(['alimtalk', 'sms']);
    expect(Object.keys(snapshot.channels.alimtalk).sort()).toEqual([
      'appliedRetryDelay',
      'errorClassCounts',
    ]);
    expect(Object.keys(snapshot.channels.alimtalk.errorClassCounts).sort()).toEqual([
      'PERMANENT',
      'RATE_LIMITED',
      'RETRYABLE',
      'UNKNOWN',
    ]);
    expect(Object.keys(snapshot.channels.alimtalk.appliedRetryDelay).sort()).toEqual([
      'count',
      'lastMs',
      'maxMs',
      'minMs',
      'totalMs',
    ]);
  });
});

describe('NOTIFICATION_RETRY_METRICS — 기존 전달 결과 불변', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('기존 1-인자 생성자와 전달 결과 계약을 그대로 유지한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(0));

    const client = new AligoClient(makeConfig());
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toEqual({
      success: true,
      outcome: 'ACCEPTED',
      errorClass: null,
      channel: 'alimtalk',
      message: renderNotificationMessage(templateCode, variables),
      alimtalkAttempts: 2,
      smsAttempts: 0,
      providerReceipt: null,
      attemptId: expect.any(String),
      needsVerify: false,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('recorder 주입 여부와 무관하게 동일한 전달 결과를 반환한다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(400, '잘못된 요청입니다'))
      .mockResolvedValueOnce(response(0))
      .mockResolvedValueOnce(response(400, '잘못된 요청입니다'))
      .mockResolvedValueOnce(response(0));

    const injected = makeClient();
    const withDefaultRecorder = new AligoClient(makeConfig());

    const injectedResult = await injected.client.sendAlimtalk(phone, templateCode, variables);
    const defaultResult = await withDefaultRecorder.sendAlimtalk(phone, templateCode, variables);

    expect(injectedResult).toMatchObject({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'sms',
      message: renderNotificationMessage(templateCode, variables),
      alimtalkAttempts: 1,
      smsAttempts: 1,
      needsVerify: false,
    });
    expect({ ...injectedResult, attemptId: 'normalized' }).toEqual({
      ...defaultResult,
      attemptId: 'normalized',
    });
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
