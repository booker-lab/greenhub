import { ArgumentsHost, ConflictException } from '@nestjs/common';
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

function httpHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', route: { path: '/stores/:storeId/orders' } }),
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
