import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpsAlertService } from '../../ops-alerts/ops-alert.service';
import {
  FirestoreRetryableErrorFilter,
  RETRYABLE_FIRESTORE_MESSAGE,
  retryableFirestoreCode,
} from './firestore-retryable-error.filter';

function grpcError(code: number, status: string) {
  return Object.assign(new Error(`${code} ${status}: Too much contention on these documents.`), {
    code,
    details: 'Too much contention on these documents.',
    metadata: {},
  });
}

function httpHost(type = 'http') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/stores/store-secret-1/orders?orderId=order-secret-1',
        route: { path: '/stores/:storeId/orders' },
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('retryableFirestoreCode', () => {
  it.each([
    [4, 'DEADLINE_EXCEEDED'],
    [10, 'ABORTED'],
    [14, 'UNAVAILABLE'],
  ])('Firestore gRPC %s %s는 다시 시도할 수 있는 실패다', (code, status) => {
    expect(retryableFirestoreCode(grpcError(code, status))).toBe(code);
  });

  it('다른 gRPC 실패와 HTTP 예외, 숫자 code만 같은 일반 오류는 제외한다', () => {
    expect(retryableFirestoreCode(grpcError(9, 'FAILED_PRECONDITION'))).toBeNull();
    expect(retryableFirestoreCode(new ConflictException('회차 상품 수량이 마감되었습니다.'))).toBeNull();
    expect(retryableFirestoreCode(Object.assign(new Error('boom'), { code: 10 }))).toBeNull();
    expect(retryableFirestoreCode(Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }))).toBeNull();
    expect(retryableFirestoreCode(null)).toBeNull();
  });
});

describe('FirestoreRetryableErrorFilter', () => {
  it('트랜잭션 경합(ABORTED)은 영어 500 대신 503과 다시 시도 안내로 응답한다', () => {
    const filter = new FirestoreRetryableErrorFilter();
    const { host, status, json } = httpHost();

    filter.catch(grpcError(10, 'ABORTED'), host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      error: 'Service Unavailable',
      message: RETRYABLE_FIRESTORE_MESSAGE,
      retryable: true,
    });
  });

  it('그 밖의 예외는 Nest 기본 처리에 그대로 넘긴다', () => {
    const filter = new FirestoreRetryableErrorFilter();
    const baseCatch = jest
      .spyOn(Object.getPrototypeOf(FirestoreRetryableErrorFilter.prototype), 'catch')
      .mockImplementation(() => undefined);
    const { host, status } = httpHost();
    const conflict = new ConflictException('회차 상품 수량이 마감되었습니다.');

    filter.catch(conflict, host);

    expect(baseCatch).toHaveBeenCalledWith(conflict, host);
    expect(status).not.toHaveBeenCalled();
    baseCatch.mockRestore();
  });
});

describe('FirestoreRetryableErrorFilter 서버 오류 알림', () => {
  function enabledAlert() {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const config = new ConfigService({
      OPS_TELEGRAM_BOT_TOKEN: 'bot-token',
      OPS_TELEGRAM_CHAT_ID: '12345',
    });
    const alert = new OpsAlertService(config, fetchImpl);
    const send = jest.spyOn(alert, 'send');
    return { alert, send, fetchImpl };
  }

  let baseCatch: jest.SpyInstance;
  beforeEach(() => {
    baseCatch = jest
      .spyOn(Object.getPrototypeOf(FirestoreRetryableErrorFilter.prototype), 'catch')
      .mockImplementation(() => undefined);
  });
  afterEach(() => baseCatch.mockRestore());

  it('HttpException이 아닌 예외는 경로 패턴과 오류 이름만 담아 1회 알린다', async () => {
    const { alert, send, fetchImpl } = enabledAlert();
    const filter = new FirestoreRetryableErrorFilter(alert);
    const error = new TypeError("Cannot read properties of undefined (reading 'order-secret-1')");

    filter.catch(error, httpHost().host);

    expect(baseCatch).toHaveBeenCalledWith(error, expect.anything());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      level: 'critical',
      title: '서버 오류 500',
      lines: ['요청: POST /stores/:storeId/orders', '오류: TypeError'],
      dedupeKey: 'server-error:POST /stores/:storeId/orders:TypeError',
    });
    await Promise.resolve();
    const body = String((fetchImpl.mock.calls[0]?.[1] as { body?: string })?.body ?? '');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('Cannot read');
  });

  it('500 이상 HttpException도 알리고, 같은 경로·오류는 30분 안에 한 번만 보낸다', async () => {
    const { alert, fetchImpl } = enabledAlert();
    const filter = new FirestoreRetryableErrorFilter(alert);

    filter.catch(new InternalServerErrorException('주문 order-secret-1 실패'), httpHost().host);
    filter.catch(new InternalServerErrorException('주문 order-secret-2 실패'), httpHost().host);
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = String((fetchImpl.mock.calls[0]?.[1] as { body?: string })?.body ?? '');
    expect(body).toContain('InternalServerErrorException');
    expect(body).not.toContain('order-secret');
  });

  it('의도된 503, 4xx, statusCode를 가진 요청 오류, Firestore 일시 오류는 알리지 않는다', () => {
    const { alert, send } = enabledAlert();
    const filter = new FirestoreRetryableErrorFilter(alert);

    filter.catch(new ServiceUnavailableException('재배송비 환불이 아직 끝나지 않았습니다.'), httpHost().host);
    filter.catch(new BadRequestException('잘못된 요청'), httpHost().host);
    filter.catch(new ConflictException('회차 상품 수량이 마감되었습니다.'), httpHost().host);
    filter.catch(
      Object.assign(new SyntaxError('Unexpected token'), { statusCode: 400, status: 400 }),
      httpHost().host,
    );
    filter.catch(grpcError(10, 'ABORTED'), httpHost().host);

    expect(send).not.toHaveBeenCalled();
  });

  it('HTTP 요청이 아니거나 알림이 꺼져 있으면 보내지 않는다', () => {
    const { alert, send } = enabledAlert();
    new FirestoreRetryableErrorFilter(alert).catch(new Error('boom'), httpHost('rpc').host);
    expect(send).not.toHaveBeenCalled();

    const disabled = new OpsAlertService(new ConfigService({}));
    const disabledSend = jest.spyOn(disabled, 'send');
    new FirestoreRetryableErrorFilter(disabled).catch(new Error('boom'), httpHost().host);
    expect(disabledSend).not.toHaveBeenCalled();

    expect(() =>
      new FirestoreRetryableErrorFilter().catch(new Error('boom'), httpHost().host),
    ).not.toThrow();
  });
});
