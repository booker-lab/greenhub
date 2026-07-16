import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PortoneClient, PortoneError } from './portone.client';

describe('PortoneClient V2 진단', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
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
});
