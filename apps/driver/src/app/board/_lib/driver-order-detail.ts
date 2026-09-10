/**
 * Driver detail read/command pure contract helper.
 *
 * Server authority를 유지하기 위한 최소 분류만 둔다.
 * - detail HTTP status classification (404 / 401·403 / 그 외·network)
 * - detail scope identity (orderId + user identity + role + access token)
 * - command 401·403 authority-loss classification (legacy fail-closed fallback)
 * - command status + stable error-code recovery classification
 *   (AUTHORITY_LOSS / STATE_CONFLICT / NOT_FOUND / UNCERTAIN)
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
 *
 * @deprecated status-only fallback. 신규 command 경로는
 * `classifyDriverOrderCommandError` (status + stable error code)를 사용한다.
 * 403은 code가 STATE_CONFLICT이면 authority loss가 아니다. 본 함수는
 * unknown/missing-code 403의 fail-closed fallback으로만 유지된다.
 */
export function isDriverOrderCommandAuthLoss(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Driver command error-code convergence (client-local recovery meaning).
 *
 * Server/shared stable wire-code SSOT는
 * `packages/shared/src/driver-order-error.types.ts`가 소유한다:
 * - DRIVER_ORDER_AUTHORITY_DENIED
 * - DRIVER_ORDER_STATE_CONFLICT
 * - DRIVER_ORDER_NOT_FOUND
 *
 * 본 helper는 wire 문자열을 그대로 인식만 하며, shared에 client UX/recovery
 * 의미를 추가하지 않는다. DRIVER_ORDER_ALREADY_APPLIED는 서버 Task에서
 * DEFERRED_NOT_PROVABLE로 결정됐으므로 여기서 새로 정의·추론하지 않는다.
 */
export type DriverOrderCommandErrorCode =
  | 'DRIVER_ORDER_AUTHORITY_DENIED'
  | 'DRIVER_ORDER_STATE_CONFLICT'
  | 'DRIVER_ORDER_NOT_FOUND';

/**
 * status + code → client recovery classification.
 * - AUTHORITY_LOSS: protected order/PII 즉시 제거, AUTH_ERROR 수렴, resend 금지.
 * - STATE_CONFLICT: 로그인 오류 아님, resend 금지, authoritative GET 수렴.
 * - NOT_FOUND: authoritative absence/hiding, 이전 order 불신, resend 금지.
 * - UNCERTAIN: 성공 추론 금지, resend 금지, 기존 ACK-uncertain/GET 수렴 유지.
 */
export type DriverOrderCommandRecovery =
  | 'AUTHORITY_LOSS'
  | 'STATE_CONFLICT'
  | 'NOT_FOUND'
  | 'UNCERTAIN';

/**
 * error envelope에서 stable code만 안전하게 읽는다.
 * body parsing 실패·형식 불일치·ratified 외 문자열은 모두 null이다.
 * null 때문에 same-command resend를 유도하지 않으며, 호출자는
 * `classifyDriverOrderCommandError`의 fail-closed fallback을 사용한다.
 * DRIVER_ORDER_ALREADY_APPLIED를 포함한 미정의 코드는 절대 인식하지 않는다.
 */
export function readDriverOrderErrorCode(body: unknown): DriverOrderCommandErrorCode | null {
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as { code?: unknown }).code;
  if (
    code === 'DRIVER_ORDER_AUTHORITY_DENIED' ||
    code === 'DRIVER_ORDER_STATE_CONFLICT' ||
    code === 'DRIVER_ORDER_NOT_FOUND'
  ) {
    return code;
  }
  return null;
}

/**
 * Response error envelope의 code를 안전하게 읽는다.
 * body가 비었거나 malformed이거나 json 파싱이 실패해도 throw하지 않고
 * null을 반환한다. null 자체가 resend를 유도하지 않는다.
 */
export async function readDriverOrderCommandErrorCodeFromResponse(
  response: Pick<Response, 'json'>,
): Promise<DriverOrderCommandErrorCode | null> {
  try {
    const body: unknown = await response.json();
    return readDriverOrderErrorCode(body);
  } catch {
    return null;
  }
}

/**
 * status + code를 client recovery 의미로 분류한다.
 * HTTP status만 보지 않으며, 가능한 경우 envelope code가 우선한다.
 *
 * - 401은 code와 무관하게 AUTHORITY_LOSS다.
 * - DRIVER_ORDER_AUTHORITY_DENIED는 status와 무관하게 AUTHORITY_LOSS다.
 * - DRIVER_ORDER_NOT_FOUND는 authoritative absence/hiding으로 NOT_FOUND다.
 * - 403/409 + DRIVER_ORDER_STATE_CONFLICT는 STATE_CONFLICT다.
 * - code 없는 unknown/missing 403은 기존 보안 경계를 낮추지 않도록
 *   fail-closed AUTHORITY_LOSS로 유지한다.
 * - 그 외 ratified 코드 없음·malformed·예상 밖 4xx/5xx는 UNCERTAIN이다.
 *   (404 body 미판독/코드 없음도 UNCERTAIN이며 새로운 성공 의미를 추론하지 않는다)
 */
export function classifyDriverOrderCommandError(args: {
  status: number;
  code: DriverOrderCommandErrorCode | string | null | undefined;
}): DriverOrderCommandRecovery {
  const { status, code } = args;
  if (status === 401) return 'AUTHORITY_LOSS';
  if (code === 'DRIVER_ORDER_AUTHORITY_DENIED') return 'AUTHORITY_LOSS';
  if (code === 'DRIVER_ORDER_NOT_FOUND') return 'NOT_FOUND';
  if (
    code === 'DRIVER_ORDER_STATE_CONFLICT' &&
    (status === 403 || status === 409)
  ) {
    return 'STATE_CONFLICT';
  }
  if (status === 403) return 'AUTHORITY_LOSS';
  return 'UNCERTAIN';
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
