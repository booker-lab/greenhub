/**
 * Driver detail read/command pure contract helper.
 *
 * Server authority를 유지하기 위한 최소 분류만 둔다.
 * - detail HTTP status classification (404 / 401·403 / 그 외·network)
 * - detail scope identity (orderId + user identity + role + access token)
 * - command 401·403 authority-loss classification
 * - command scope/sequence continuation binding
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
 * authoritative GET 실패 때 이전 order를 화면에 유지해도 되는가.
 *
 * - AUTH_ERROR(401·403): authority loss이므로 절대 유지하지 않는다.
 * - NOT_FOUND(404): authoritative absence이므로 절대 유지하지 않는다.
 * - FETCH_ERROR(network/5xx 등): 일시적 refresh 실패만 이전 내용을 stale로 유지할 수 있다.
 */
export function shouldPreserveDriverOrderOnReadError(
  kind: DriverOrderReadErrorKind,
  hasOrder: boolean,
): boolean {
  if (!hasOrder) return false;
  return kind === 'FETCH_ERROR';
}

/**
 * 현재 read confidence에서 status 변경 계열 command를 노출·실행해도 되는가.
 *
 * - order 없음 → 불가
 * - readError 존재(AUTH/NOT_FOUND/FETCH 모두) → 불가
 *   (AUTH/NOT_FOUND는 원칙적으로 order가 이미 제거된 상태이며, 이중 fail-closed다)
 * - readbackWarning 존재(처리 완료 후 최신 상태 미확인) → 불가
 * - fresh order + error 없음 + warning 없음 → 가능
 */
export function isDriverOrderCommandAllowed(args: {
  hasOrder: boolean;
  readErrorKind: DriverOrderReadErrorKind | null;
  hasReadbackWarning: boolean;
}): boolean {
  if (!args.hasOrder) return false;
  if (args.hasReadbackWarning) return false;
  if (args.readErrorKind !== null) return false;
  return true;
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

/**
 * detail scope identity: order identity + current authenticated principal/scope.
 *
 * list shared owner의 user-id + role + access-token 의미를 detail 최소 형태로
 * 확장한다. token 문자열 하나만을 principal 전체의 암묵적 owner로 사용하지
 * 않는다. 빈 값은 명시적 sentinel로 정규화하여 scope 비교가 항상 문자열
 * 동등성으로 동작하도록 한다.
 */
export function buildDriverOrderDetailScope(args: {
  orderId: string;
  userId?: string | null;
  role?: string | null;
  token?: string | null;
}): string {
  const userId = args.userId && args.userId.length > 0 ? args.userId : '__no_user__';
  const role = args.role && args.role.length > 0 ? args.role : '__no_role__';
  const token = args.token && args.token.length > 0 ? args.token : '__no_token__';
  return `${args.orderId}::${userId}::${role}::${token}`;
}

/**
 * command PATCH 자체의 401·403은 authority loss다.
 * 409/422/5xx의 command recovery architecture를 재정의하지 않으며,
 * 이 판정은 401·403만을 AUTH_ERROR branch로 보낸다.
 */
export function isDriverOrderCommandAuthLoss(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * command async continuation이 아직 동일 command generation + 동일 scope인지
 * 판정한다. scope가 바뀌었거나 더 새로운 command가 시작됐으면 이전 ACK/
 * readback/error/finally/navigation을 새 scope UI에 절대 반영하지 않는다.
 * 이미 서버에 전달된 command 결과를 client가 취소됐다고 거짓 판정하지 않으며,
 * 자동 resend도 하지 않는다. 호출자는 false일 때 state mutation·navigation·
 * notification·reread를 모두 건너뛰어야 한다.
 */
export function isDriverOrderCommandContinuationCurrent(args: {
  snapshotSeq: number;
  snapshotScope: string | null;
  currentSeq: number;
  currentScope: string | null;
}): boolean {
  return args.snapshotSeq === args.currentSeq && args.snapshotScope === args.currentScope;
}
