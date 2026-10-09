import type { ConfigService } from '@nestjs/config';

const undiciFetch = jest.fn();

jest.mock('undici', () => ({
  ProxyAgent: jest.fn().mockImplementation(() => ({ kind: 'proxy-agent' })),
  fetch: (...args: unknown[]) => undiciFetch(...args),
}));

import {
  ALIGO_REQUEST_TIMEOUT_MS,
  AligoClient,
  computeNotificationRetryDelayMs,
} from './aligo.client';

type Data = Record<string, unknown>;
type FetchInit = { method: string; body: URLSearchParams; signal?: AbortSignal };

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

// 응답하지 않는 ALIGO/프록시를 흉내 낸다. undici·전역 fetch처럼 신호가 끊기면 그 이유로
// reject하고, 신호가 없으면(시간 제한이 없는 예전 코드) 영원히 끝나지 않는다.
function stalledFetch(_url: string, init: FetchInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
}

// 상한 직전에 ALIGO 오류 응답(재시도 가능 -1)을 돌려주는 느린 provider.
function slowRetryableResponse(delayMs: number) {
  return (_url: string, init: FetchInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve({
            status: 200,
            json: async () => ({ code: -1, result_code: -1, message: '일시 오류' }),
          } as unknown as Response),
        delayMs,
      );
      init.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        },
        { once: true },
      );
    });
}

function track<T>(promise: Promise<T>) {
  const state = { settled: false };
  promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );
  return state;
}

describe('ALIGO HTTP 호출 시간 제한', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    undiciFetch.mockReset();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('상한은 유한한 양수이고 8~10초 범위다', () => {
    expect(ALIGO_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(8_000);
    expect(ALIGO_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('직접 호출: 알림톡이 응답하지 않으면 상한에서 끊고 UNKNOWN으로 멈춘다(재시도·SMS 없음)', async () => {
    (global.fetch as jest.Mock).mockImplementation(stalledFetch);
    const client = makeClient();

    const promise = client.sendAlimtalk(phone, templateCode, variables);
    const state = track(promise);
    await jest.advanceTimersByTimeAsync(ALIGO_REQUEST_TIMEOUT_MS - 1);
    expect(state.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    const result = await promise;
    expect(result).toMatchObject({
      success: false,
      outcome: 'UNKNOWN',
      errorClass: 'UNKNOWN',
      channel: null,
      alimtalkAttempts: 1,
      smsAttempts: 0,
      needsVerify: true,
    });
    expect(result.errorMessage).toContain(`${ALIGO_REQUEST_TIMEOUT_MS}ms`);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as FetchInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('프록시 경유: dispatcher와 시간 제한 신호를 함께 넘기고 상한에서 UNKNOWN으로 멈춘다', async () => {
    undiciFetch.mockImplementation(stalledFetch);
    const client = makeClient({
      ...configured,
      ALIGO_OUTBOUND_PROXY_URL: 'http://proxy.example.test:80',
    });

    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.advanceTimersByTimeAsync(ALIGO_REQUEST_TIMEOUT_MS);

    await expect(promise).resolves.toMatchObject({
      outcome: 'UNKNOWN',
      alimtalkAttempts: 1,
      smsAttempts: 0,
      needsVerify: true,
    });
    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch).toHaveBeenCalledWith(
      'https://kakaoapi.aligo.in/akv10/alimtalk/send/',
      expect.objectContaining({
        dispatcher: { kind: 'proxy-agent' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('직접 문자 발송도 응답하지 않으면 상한에서 UNKNOWN으로 끝난다', async () => {
    (global.fetch as jest.Mock).mockImplementation(stalledFetch);
    const client = makeClient();

    const promise = client.sendSms(phone, templateCode, variables);
    await jest.advanceTimersByTimeAsync(ALIGO_REQUEST_TIMEOUT_MS);

    const result = await promise;
    expect(result).toMatchObject({
      outcome: 'UNKNOWN',
      alimtalkAttempts: 0,
      smsAttempts: 1,
      needsVerify: true,
    });
    expect(result.errorMessage).toContain('문자');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('응답 헤더 뒤 본문이 멈춰도 같은 상한이 본문 읽기까지 끊는다', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init: FetchInit) => ({
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    }));
    const client = makeClient();

    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.advanceTimersByTimeAsync(ALIGO_REQUEST_TIMEOUT_MS);

    const result = await promise;
    expect(result).toMatchObject({ outcome: 'UNKNOWN', alimtalkAttempts: 1, smsAttempts: 0 });
    expect(result.errorMessage).toContain(`${ALIGO_REQUEST_TIMEOUT_MS}ms`);
  });

  it('최악 지연: 매 시도가 상한 직전 재시도 가능 오류면 알림톡 3회+SMS 1회 = 4×상한+backoff 안에 끝난다', async () => {
    const nearLimit = ALIGO_REQUEST_TIMEOUT_MS - 1;
    (global.fetch as jest.Mock)
      .mockImplementationOnce(slowRetryableResponse(nearLimit))
      .mockImplementationOnce(slowRetryableResponse(nearLimit))
      .mockImplementationOnce(slowRetryableResponse(nearLimit))
      .mockImplementationOnce(stalledFetch);
    const client = makeClient();

    const promise = client.sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      outcome: 'UNKNOWN',
      alimtalkAttempts: 3,
      smsAttempts: 1,
      needsVerify: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    const backoff =
      computeNotificationRetryDelayMs('RETRYABLE', 0) +
      computeNotificationRetryDelayMs('RETRYABLE', 1);
    expect(jest.now()).toBe(3 * nearLimit + backoff + ALIGO_REQUEST_TIMEOUT_MS);
    expect(jest.now()).toBeLessThanOrEqual(4 * ALIGO_REQUEST_TIMEOUT_MS + backoff);
  });

  it('제때 응답하면 시간 제한 타이머를 남기지 않는다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      json: async () => ({ code: 0, info: { mid: 1 } }),
    });
    const client = makeClient();

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      alimtalkAttempts: 1,
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});
