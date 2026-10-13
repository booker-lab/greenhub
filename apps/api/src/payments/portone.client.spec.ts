import * as crypto from 'node:crypto';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigModule, type ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  PORTONE_GET_PAYMENT_TIMEOUT_MS,
  PORTONE_REFUND_TIMEOUT_MS,
  PortoneClient,
  PortoneError,
} from './portone.client';

describe('PortoneClient V2 진단', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const makeWebhookClient = (secret = 'whsec_dGVzdC1zZWNyZXQ=') =>
    new PortoneClient({
      get: jest.fn((key: string, fallback: string) =>
        key === 'PORTONE_WEBHOOK_SECRET' ? secret : fallback,
      ),
    } as unknown as ConfigService);

  const signWebhook = (id: string, timestamp: string, body: Buffer) =>
    crypto
      .createHmac('sha256', Buffer.from('test-secret'))
      .update(`${id}.${timestamp}.${body.toString()}`)
      .digest('base64');

  it('웹훅 서명이 누락되면 인증 실패한다', () => {
    expect(() =>
      makeWebhookClient().verifyWebhookSignature(
        'webhook-1',
        String(Math.floor(Date.now() / 1000)),
        Buffer.from('{}'),
        '',
      ),
    ).toThrow(UnauthorizedException);
  });

  it('웹훅 Secret이 누락되면 인증 실패한다', () => {
    expect(() =>
      makeWebhookClient('').verifyWebhookSignature(
        'webhook-1',
        String(Math.floor(Date.now() / 1000)),
        Buffer.from('{}'),
        'v1,signature',
      ),
    ).toThrow(UnauthorizedException);
  });

  it('허용 시간보다 오래된 timestamp는 유효한 서명이어도 인증 실패한다', () => {
    const now = new Date('2026-07-17T00:10:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const timestamp = String(Math.floor(now.getTime() / 1000) - 301);
    const body = Buffer.from('{"type":"Transaction.Paid"}');
    const signature = signWebhook('webhook-1', timestamp, body);

    expect(() =>
      makeWebhookClient().verifyWebhookSignature('webhook-1', timestamp, body, `v1,${signature}`),
    ).toThrow(UnauthorizedException);
    jest.useRealTimers();
  });

  it('PORTONE_V2_SECRET을 PortOne 인증 형식으로 전달한다', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'payment-1',
          transactionId: 'transaction-1',
          amount: { total: 100 },
          status: 'PAID',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock;

    const client = new PortoneClient({
      get: jest.fn().mockReturnValue('v2-test-secret'),
    } as unknown as ConfigService);

    await client.getPayment('payment-1');

    expect(fetchMock).toHaveBeenCalledWith('https://api.portone.io/payments/payment-1', {
      headers: { Authorization: 'PortOne v2-test-secret' },
      signal: expect.any(AbortSignal),
    });
  });

  it('401 응답에서 status, type, message만 안전하게 기록한다', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'UNAUTHORIZED',
          message: 'invalid\napi secret',
          authorization: '노출되면 안 되는 값',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const client = new PortoneClient({
      get: jest.fn().mockReturnValue('v2-test-secret'),
    } as unknown as ConfigService);

    const error = await client.getPayment('payment-1').catch((caught) => caught);

    expect(error).toBeInstanceOf(PortoneError);
    expect(error).toMatchObject({
      status: 401,
      type: 'UNAUTHORIZED',
      message: 'invalid api secret',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'PortOne V2 인증 실패 action=getPayment status=401 type=UNAUTHORIZED message=invalid api secret',
    );
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('노출되면 안 되는 값');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('v2-test-secret');
  });

  it('404 PAYMENT_NOT_FOUND를 정제된 전용 오류로 보존한다', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'PAYMENT_NOT_FOUND',
          message: 'payment\nnot found',
          authorization: '노출되면 안 되는 값',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const client = new PortoneClient({
      get: jest.fn().mockReturnValue('v2-test-secret'),
    } as unknown as ConfigService);

    const error = await client.getPayment('payment-1').catch((caught) => caught);

    expect(error).toBeInstanceOf(PortoneError);
    expect(error).toMatchObject({
      status: 404,
      type: 'PAYMENT_NOT_FOUND',
      message: 'payment not found',
    });
    expect(String(error)).not.toContain('노출되면 안 되는 값');
  });

  it('일반 404를 PAYMENT_NOT_FOUND와 구분한다', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'UNKNOWN_RESOURCE',
          message: 'unknown payment resource',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const client = new PortoneClient({
      get: jest.fn().mockReturnValue('v2-test-secret'),
    } as unknown as ConfigService);

    const error = await client.getPayment('payment-1').catch((caught) => caught);

    expect(error).toBeInstanceOf(PortoneError);
    expect(error).toMatchObject({
      status: 404,
      type: 'UNKNOWN_RESOURCE',
      message: 'unknown payment resource',
    });
    expect(error.type).not.toBe('PAYMENT_NOT_FOUND');
  });

  describe('local DENY_ALL_EXTERNAL_PROVIDER_DISPATCH', () => {
    const makeDenyClient = () =>
      new PortoneClient({
        get: jest.fn((key: string, fallback: string) =>
          key === 'GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY'
            ? 'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH'
            : fallback,
        ),
      } as unknown as ConfigService);

    it('조회 dispatch를 차단하고 외부 fetch를 하지 않는다', async () => {
      global.fetch = jest.fn();
      const error = await makeDenyClient()
        .getPayment('payment-1')
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(PortoneError);
      expect(error).toMatchObject({ status: 503, type: 'LOCAL_OUTBOUND_DENIED' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('환불 dispatch를 차단하고 외부 fetch를 하지 않는다', async () => {
      global.fetch = jest.fn();
      const error = await makeDenyClient()
        .refund('payment-1', 100, '사유')
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(PortoneError);
      expect(error).toMatchObject({ status: 503, type: 'LOCAL_OUTBOUND_DENIED' });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  it('Nest DI에서 ConfigService를 주입받아 생성된다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
      providers: [PortoneClient],
    }).compile();

    expect(moduleRef.get(PortoneClient)).toBeInstanceOf(PortoneClient);
    await moduleRef.close();
  });

  describe('요청 시간 상한', () => {
    const makeClient = () =>
      new PortoneClient({
        get: jest.fn((_key: string, fallback: string) => fallback),
      } as unknown as ConfigService);

    // 응답하지 않는 PortOne: abort 신호가 올 때까지 끝나지 않는다.
    const hangingFetch = () =>
      jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('This operation was aborted', 'AbortError')),
            );
          }),
      );

    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('조회가 상한을 넘기면 PortoneError(504, PORTONE_TIMEOUT)로 끝난다', async () => {
      global.fetch = hangingFetch() as unknown as typeof fetch;

      const pending = makeClient()
        .getPayment('payment-1')
        .catch((caught) => caught);
      await jest.advanceTimersByTimeAsync(PORTONE_GET_PAYMENT_TIMEOUT_MS - 1);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);

      const error = await pending;
      expect(error).toBeInstanceOf(PortoneError);
      expect(error).toMatchObject({ status: 504, type: 'PORTONE_TIMEOUT' });
    });

    it('환불이 상한을 넘기면 PortoneError(504, PORTONE_TIMEOUT)로 끝난다', async () => {
      global.fetch = hangingFetch() as unknown as typeof fetch;

      const pending = makeClient()
        .refund('payment-1', 100, '사유')
        .catch((caught) => caught);
      await jest.advanceTimersByTimeAsync(PORTONE_GET_PAYMENT_TIMEOUT_MS);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(
        PORTONE_REFUND_TIMEOUT_MS - PORTONE_GET_PAYMENT_TIMEOUT_MS,
      );

      const error = await pending;
      expect(error).toBeInstanceOf(PortoneError);
      expect(error).toMatchObject({ status: 504, type: 'PORTONE_TIMEOUT' });
    });

    it('정상 응답 뒤에는 타이머를 남기지 않는다', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 'payment-1', status: 'PAID' }), { status: 200 }),
        );

      await makeClient().getPayment('payment-1');
      await makeClient().refund('payment-1', 100, '사유');

      expect(jest.getTimerCount()).toBe(0);
    });

    it('시간 초과가 아닌 네트워크 오류는 그대로 전달한다', async () => {
      const networkError = new TypeError('fetch failed');
      global.fetch = jest.fn().mockRejectedValue(networkError);

      await expect(makeClient().getPayment('payment-1')).rejects.toBe(networkError);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
