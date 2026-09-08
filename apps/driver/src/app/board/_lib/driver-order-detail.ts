/**
 * Driver detail read/command pure contract helper.
 *
 * Server authority를 유지하기 위한 최소 분류만 둔다.
 * - detail HTTP status classification (404 / 401·403 / 그 외·network)
 * - command semantic ACK matching (orderId + status)
 *
 * 어떤 Server mutation policy도 재정의하지 않으며,
 * raw Firestore read나 payment 의미 재조합을 도입하지 않는다.
 */

export type DriverOrderReadErrorKind = 'NOT_FOUND' | 'AUTH_ERROR' | 'FETCH_ERROR';

export class DriverOrderReadError extends Error {
  readonly kind: DriverOrderReadErrorKind;
  readonly status: number | null;

  constructor(kind: DriverOrderReadErrorKind, status: number | null, message: string) {
    super(message);
    this.name = 'DriverOrderReadError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * detail GET의 HTTP status를 세 의미로 분류한다.
 * 존재 여부 은폐가 API contract상 404로 표현되면 그대로 NOT_FOUND로 둔다.
 */
export function classifyDriverOrderReadError(status: number): DriverOrderReadErrorKind {
  if (status === 404) return 'NOT_FOUND';
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  return 'FETCH_ERROR';
}

export function toDriverOrderReadError(
  status: number,
  fallbackMessage = '주문 정보를 불러오지 못했습니다',
): DriverOrderReadError {
  const kind = classifyDriverOrderReadError(status);
  if (kind === 'NOT_FOUND') {
    return new DriverOrderReadError(kind, status, '주문을 찾을 수 없습니다');
  }
  if (kind === 'AUTH_ERROR') {
    return new DriverOrderReadError(kind, status, '로그인 정보를 다시 확인해 주세요.');
  }
  return new DriverOrderReadError(kind, status, fallbackMessage);
}

export function toDriverOrderNetworkError(
  fallbackMessage = '주문 정보를 불러오지 못했습니다',
): DriverOrderReadError {
  return new DriverOrderReadError('FETCH_ERROR', null, fallbackMessage);
}

/**
 * command semantic ACK: 서버가 반환한 orderId와 status가
 * 요청한 값과 정확히 일치해야 성공이다.
 */
export function isDriverOrderStatusAck(
  result: { orderId?: unknown; status?: unknown },
  expectedOrderId: string,
  expectedStatus: string,
): boolean {
  return result.orderId === expectedOrderId && result.status === expectedStatus;
}
