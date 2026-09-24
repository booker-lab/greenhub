import type { ConfigService } from '@nestjs/config';
import {
  AligoClient,
  classifyAlimtalkProviderError,
  classifySmsProviderError,
  computeNotificationRetryDelayMs,
  NOTIFICATION_RETRY_BACKOFF_POLICY,
} from './aligo.client';

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

function makeClient(config: Data = configured) {
  const configService = {
    get: jest.fn((key: string, fallback: string) => config[key] ?? fallback),
  } as unknown as ConfigService;
  return new AligoClient(configService);
}

function response(code: number, message = '오류', status?: number) {
  return {
    status,
    json: jest.fn().mockResolvedValue({ code, message }),
  } as unknown as Response;
}

describe('NOTIFICATION_RETRY_BACKOFF_POLICY', () => {
  it('알림톡 3회 상한·문자 1회 fallback과 유한한 지연 범위를 고정한다', () => {
    expect(NOTIFICATION_RETRY_BACKOFF_POLICY.maxAlimtalkAttempts).toBe(3);
    expect(NOTIFICATION_RETRY_BACKOFF_POLICY.maxSmsFallbackAttempts).toBe(1);
    expect(NOTIFICATION_RETRY_BACKOFF_POLICY.baseBackoffMs).toBeGreaterThan(0);
    expect(NOTIFICATION_RETRY_BACKOFF_POLICY.maxBackoffMs).toBeGreaterThanOrEqual(
      NOTIFICATION_RETRY_BACKOFF_POLICY.baseBackoffMs,
    );
    expect(NOTIFICATION_RETRY_BACKOFF_POLICY.rateLimitBackoffMs).toBeGreaterThanOrEqual(
      NOTIFICATION_RETRY_BACKOFF_POLICY.baseBackoffMs,
    );
  });

  it('재시도 지연은 지수적으로 증가하되 maxBackoffMs에서 상한된다', () => {
    const first = computeNotificationRetryDelayMs('RETRYABLE', 0);
    const second = computeNotificationRetryDelayMs('RETRYABLE', 1);
    expect(first).toBe(NOTIFICATION_RETRY_BACKOFF_POLICY.baseBackoffMs);
    expect(second).toBeGreaterThan(first);
    expect(computeNotificationRetryDelayMs('RETRYABLE', 50)).toBe(
      NOTIFICATION_RETRY_BACKOFF_POLICY.maxBackoffMs,
    );
  });

  it('rate-limit 지연은 일반 재시도 base보다 길고 같은 상한을 따른다', () => {
    const retryBase = computeNotificationRetryDelayMs('RETRYABLE', 0);
    const rateBase = computeNotificationRetryDelayMs('RATE_LIMITED', 0);
    expect(rateBase).toBeGreaterThanOrEqual(retryBase);
    expect(rateBase).toBe(NOTIFICATION_RETRY_BACKOFF_POLICY.rateLimitBackoffMs);
    expect(computeNotificationRetryDelayMs('RATE_LIMITED', 50)).toBe(
      NOTIFICATION_RETRY_BACKOFF_POLICY.maxBackoffMs,
    );
  });

  it('provider 응답을 재시도 가능·rate-limit·영구 오류로 분류한다', () => {
    expect(classifyAlimtalkProviderError({ code: -1, message: '일시 오류' })).toBe('RETRYABLE');
    expect(
      classifyAlimtalkProviderError({ code: -1, message: '초당 발송 한도를 초과했습니다' }),
    ).toBe('RATE_LIMITED');
    expect(classifyAlimtalkProviderError({ httpStatus: 429, message: 'too many requests' })).toBe(
      'RATE_LIMITED',
    );
    expect(classifyAlimtalkProviderError({ code: 400, message: '잘못된 요청입니다' })).toBe(
      'PERMANENT',
    );
    expect(classifySmsProviderError({ code: -1, message: '일시 오류' })).toBe('RETRYABLE');
    expect(classifySmsProviderError({ code: 400, message: '잘못된 수신자' })).toBe('PERMANENT');
  });
});

describe('alimtalk/SMS 전달 경로의 retry·backoff·중복 방지', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('재시도 사이에 bounded backoff를 적용하고 3회 상한 안에서 성공하면 중단한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(0));

    const client = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'alimtalk',
      alimtalkAttempts: 3,
      smsAttempts: 0,
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    const expectedElapsed =
      computeNotificationRetryDelayMs('RETRYABLE', 0) +
      computeNotificationRetryDelayMs('RETRYABLE', 1);
    expect(jest.now()).toBe(expectedElapsed);
  });

  it('rate-limit 응답은 rate-limit backoff만큼 지연한 뒤 재시도한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '초당 발송 한도를 초과했습니다'))
      .mockResolvedValueOnce(response(0));

    const client = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      success: true,
      channel: 'alimtalk',
      alimtalkAttempts: 2,
      smsAttempts: 0,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const expectedElapsed = computeNotificationRetryDelayMs('RATE_LIMITED', 0);
    expect(expectedElapsed).toBeGreaterThan(computeNotificationRetryDelayMs('RETRYABLE', 0));
    expect(jest.now()).toBe(expectedElapsed);
  });

  it('rate-limit이 계속되어도 지연 총합은 maxBackoffMs로 상한되고 문자 1회로만 대체한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '발송 요청 제한 초과'))
      .mockResolvedValueOnce(response(-1, '발송 요청 제한 초과'))
      .mockResolvedValueOnce(response(-1, '발송 요청 제한 초과'))
      .mockResolvedValueOnce(response(1, '성공'));

    const client = makeClient();
    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      success: true,
      channel: 'sms',
      alimtalkAttempts: 3,
      smsAttempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    const expectedElapsed =
      computeNotificationRetryDelayMs('RATE_LIMITED', 0) +
      computeNotificationRetryDelayMs('RATE_LIMITED', 1);
    expect(expectedElapsed).toBeLessThanOrEqual(
      2 * NOTIFICATION_RETRY_BACKOFF_POLICY.maxBackoffMs,
    );
    expect(jest.now()).toBe(expectedElapsed);
  });

  it('명시적 영구 오류는 같은 채널 blind 재시도를 줄이고 문자 1회 대체로 넘긴다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(400, '잘못된 요청입니다'))
      .mockResolvedValueOnce(response(0));

    const client = makeClient();
    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: true,
      channel: 'sms',
      alimtalkAttempts: 1,
      smsAttempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const calls = (global.fetch as jest.Mock).mock.calls as Array<[string, unknown]>;
    expect(String(calls[1][0])).toContain('apis.aligo.in/send');
  });

  it('transport 불확실(UNKNOWN)에서는 blind 중복 SMS를 시도하지 않는다', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));

    const client = makeClient();
    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      outcome: 'UNKNOWN',
      needsVerify: true,
      alimtalkAttempts: 1,
      smsAttempts: 0,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('설정 누락은 backoff 없이 외부 요청 0으로 fail-closed한다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(0));

    const client = makeClient({});
    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      alimtalkAttempts: 0,
      smsAttempts: 0,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('직접 SMS rate-limit 응답은 분류되고 재전송하지 않는다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(-1, '초당 발송 한도를 초과했습니다'));

    const client = makeClient();
    await expect(client.sendSms(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      outcome: 'REJECTED',
      errorClass: 'RATE_LIMITED',
      smsAttempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
