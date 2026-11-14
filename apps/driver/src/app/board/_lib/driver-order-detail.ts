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
  fallbackMessage = '주문 정보를 불러오지 못했어요',
): DriverOrderReadError {
  const kind = classifyDriverOrderReadError(status);
  if (kind === 'NOT_FOUND') {
    return new DriverOrderReadError(kind, status, '주문을 찾을 수 없어요');
  }
  if (kind === 'AUTH_ERROR') {
    return new DriverOrderReadError(kind, status, '로그인 정보를 다시 확인해 주세요.');
  }
  return new DriverOrderReadError(kind, status, fallbackMessage);
}

export function toDriverOrderNetworkError(
  fallbackMessage = '주문 정보를 불러오지 못했어요',
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
  if (code === 'DRIVER_ORDER_STATE_CONFLICT' && (status === 403 || status === 409)) {
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

/**
 * 상세 화면이 기사 명령 뒤 "응답 불확실" 수렴에서 받는 authoritative GET 결과.
 * - order: fresh GET 성공(현재 서버 상태)
 * - error: GET 실패(readDetail이 이미 화면을 해당 의미로 수렴시킴)
 * - stale: 더 새로운 조회·scope 전환에 밀려 이 결과를 쓰면 안 됨
 */
export type DriverOrderReadback =
  | { kind: 'order'; status: string }
  | { kind: 'error'; errorKind: DriverOrderReadErrorKind }
  | { kind: 'stale' };

/**
 * 응답 불확실(시간 초과·네트워크·5xx·ACK 미확인) 명령의 결과를 fresh GET으로 판정한다.
 *
 * 서버 계약 (apps/api orders-lifecycle.service.ts · driver-order-scope.service.ts):
 * - 상태 저장(트랜잭션 commit) 뒤에 알림 발송을 기다렸다가 응답한다. 그래서 응답이 늦어
 *   시간 초과가 나도 상태는 이미 바뀌어 있을 수 있다.
 * - 같은 명령을 다시 보내면 FSM 검사(현재 상태 → 같은 상태 전이 불허)와 트랜잭션 안
 *   expectedStatus 검사로 403/409 DRIVER_ORDER_STATE_CONFLICT로 거절된다.
 *   즉 중복 적용·중복 알림은 없지만 "성공" 응답이 오지도 않는다(멱등 성공 아님, 안전 거절).
 * - 기사 상세 GET은 PREPARING·DELIVERING·DELIVERY_HELD만 보인다. 완료 전이
 *   (DELIVERED·HUB_ARRIVED)가 적용되면 상세는 404가 된다.
 *
 * 결과:
 * - APPLIED: fresh 상태가 요청 상태와 같다 → 성공으로 처리.
 * - LEFT_DRIVER_SCOPE: 완료 전이를 요청했고 상세가 404 → 기존 완료 ACK 경로와 같이
 *   목록으로 돌아가 목록 조회로 확인한다(성공이라고 단정하지 않는다).
 * - NOT_APPLIED: fresh 상태가 요청 상태와 다르다 → 반영 안 됨. 다시 눌러도 서버가 중복을 막는다.
 * - UNKNOWN: 조회 실패·stale → 불확실 경고를 유지해 fail-closed.
 */
export type DriverStatusCommandReadbackResult =
  | 'APPLIED'
  | 'LEFT_DRIVER_SCOPE'
  | 'NOT_APPLIED'
  | 'UNKNOWN';

const DRIVER_TERMINAL_COMMAND_STATUSES: readonly string[] = ['DELIVERED', 'HUB_ARRIVED'];

export function isDriverTerminalCommandStatus(status: string): boolean {
  return DRIVER_TERMINAL_COMMAND_STATUSES.includes(status);
}

export function resolveDriverStatusCommandReadback(args: {
  requestedStatus: string;
  readback: DriverOrderReadback;
}): DriverStatusCommandReadbackResult {
  const { requestedStatus, readback } = args;
  if (readback.kind === 'order') {
    return readback.status === requestedStatus ? 'APPLIED' : 'NOT_APPLIED';
  }
  if (
    readback.kind === 'error' &&
    readback.errorKind === 'NOT_FOUND' &&
    isDriverTerminalCommandStatus(requestedStatus)
  ) {
    return 'LEFT_DRIVER_SCOPE';
  }
  return 'UNKNOWN';
}

/** 불확실 수렴 뒤 fresh GET 판정(resolveDriverStatusCommandReadback) 결과 안내. */
export const DRIVER_STATUS_APPLIED_AFTER_UNCERTAIN_MESSAGE = '처리된 것을 확인했어요.';
// 서버는 이미 적용된 같은 전이를 403/409 STATE_CONFLICT로 거절하므로 다시 눌러도 두 번 처리되지 않는다.
export const DRIVER_STATUS_NOT_APPLIED_AFTER_UNCERTAIN_MESSAGE =
  '아직 처리되지 않았어요. 다시 눌러도 두 번 처리되지 않아요.';
export const DRIVER_STATUS_LEFT_SCOPE_AFTER_UNCERTAIN_MESSAGE =
  '주문이 진행 목록에서 빠졌어요. 목록에서 결과를 확인해 주세요.';

/**
 * 상태 변경(시작·재개 등) 응답 불확실 뒤 다시 읽은 결과의 안내. 그 자동 수렴과 "상태 확인"(R-08)이 같은 규칙을 쓴다.
 * 보류 저장 응답 불확실 뒤에는 불확실 경고를 띄우고 상세만 다시 읽는다. 이 안내는 "상태 확인"을 눌렀을 때만 나온다.
 * - APPLIED: "처리된 것을 확인했어요"(완료 전이면 목록으로)
 * - LEFT_DRIVER_SCOPE: 경고 + 목록으로(성공이라고 단정하지 않는다)
 * - NOT_APPLIED: 경고 "아직 처리되지 않았어요. 다시 눌러도 두 번 처리되지 않아요."
 * - UNKNOWN(조회 실패·stale): null — 안내 없이 불확실 경고를 그대로 둔다(fail-closed).
 * 어떤 결과도 같은 요청을 다시 보내게 하지 않는다.
 */
export interface DriverStatusReadbackNotice {
  tone: 'success' | 'warning';
  message: string;
  goToList: boolean;
}

export function resolveDriverStatusReadbackNotice(args: {
  requestedStatus: string;
  readback: DriverOrderReadback;
}): DriverStatusReadbackNotice | null {
  const result = resolveDriverStatusCommandReadback(args);
  if (result === 'APPLIED') {
    return {
      tone: 'success',
      message: DRIVER_STATUS_APPLIED_AFTER_UNCERTAIN_MESSAGE,
      goToList: isDriverTerminalCommandStatus(args.requestedStatus),
    };
  }
  if (result === 'LEFT_DRIVER_SCOPE') {
    return {
      tone: 'warning',
      message: DRIVER_STATUS_LEFT_SCOPE_AFTER_UNCERTAIN_MESSAGE,
      goToList: true,
    };
  }
  if (result === 'NOT_APPLIED') {
    return {
      tone: 'warning',
      message: DRIVER_STATUS_NOT_APPLIED_AFTER_UNCERTAIN_MESSAGE,
      goToList: false,
    };
  }
  return null;
}

export const DRIVER_RESUME_SUCCESS_MESSAGE = '배송을 다시 시작했어요.';
export const DRIVER_START_SUCCESS_FALLBACK_MESSAGE = '배송을 시작했어요.';
export const DRIVER_HOLD_SAVED_MESSAGE = '배송 보류를 저장했어요.';

/**
 * 정상 ACK 뒤 다시 읽어 요청한 상태가 확인됐을 때의 결과 알림(R-06).
 * - 수거 대기 → 배송 중: "{동·호수} 배송을 시작했어요."(동·호수를 모르면 "배송을 시작했어요.")
 * - 배송 보류 → 배송 중: "배송을 다시 시작했어요."
 * - 배송 보류 저장: "배송 보류를 저장했어요."
 * 다시 읽은 상태가 요청과 다르거나 그 밖의 전이면 null(알림 없음)이다. 불확실·충돌 경로는 이 함수를 쓰지 않는다.
 */
export function resolveDriverCommandSuccessMessage(args: {
  requestedStatus: string;
  fromStatus: string;
  freshStatus: string;
  place?: string | null;
}): string | null {
  if (args.freshStatus !== args.requestedStatus) return null;
  if (args.requestedStatus === 'DELIVERY_HELD') return DRIVER_HOLD_SAVED_MESSAGE;
  if (args.requestedStatus !== 'DELIVERING') return null;
  if (args.fromStatus === 'DELIVERY_HELD') return DRIVER_RESUME_SUCCESS_MESSAGE;
  if (args.fromStatus !== 'PREPARING') return null;
  const place = args.place?.trim();
  return place ? `${place} 배송을 시작했어요.` : DRIVER_START_SUCCESS_FALLBACK_MESSAGE;
}

/**
 * 배송 보류 진입 버튼을 보여도 되는가 (서버 허용 범위의 부분집합만 노출).
 *
 * 서버 `DriverOrderScopeService.assertMutationRules` 기준:
 * - 기사 보류(→ DELIVERY_HELD)는 DRIVER_TRANSITIONS상 PREPARING·DELIVERING에서만 가능하다.
 * - 그중에서도 본인 배정(`driverId === 요청자`) 주문만 허용한다.
 *   미배정 주문은 first claim(PREPARING → DELIVERING) 외 전이를 STATE_CONFLICT로 거부한다.
 *
 * 상세 응답에는 배정 여부가 없다. 기사에게 보이는 DELIVERING 주문은 본인 배정 주문뿐이므로
 * (미배정 노출은 PREPARING discovery뿐) DELIVERING만 서버가 반드시 허용하는 상태다.
 * PREPARING은 미배정(항상 거부)과 본인 배정(허용)을 구분할 수 없어 노출하지 않는다.
 * 보류 모달은 회차 직배송 주문에서만 렌더되므로 회차 직배송 여부도 함께 본다.
 */
export function isDriverHoldEntryVisible(args: {
  status: string;
  isRoundDirect: boolean;
}): boolean {
  return args.isRoundDirect && args.status === 'DELIVERING';
}

/**
 * 고객 사유(고객 책임) 보류 주문에서 보이는 할 일 안내(2026-11-14 결정, 3차 재감사 S-05).
 * 살아 있는 꽃이라 그날 가게로 돌려주고, 재배송이 정해지면 다시 수거한다.
 */
export const DRIVER_CUSTOMER_HOLD_RETURN_MESSAGE =
  '상품을 오늘 가게로 돌려주세요. 재배송이 정해지면 다시 수거해요.';

/** 고객 책임으로 보류된(아직 풀리지 않은) 주문인지. 상품 파손은 따로 안내하므로 뺀다. */
export function isCustomerResponsibleHold(
  hold:
    | { customerResponsible?: unknown; reasonCode?: unknown; resolvedAt?: unknown }
    | null
    | undefined,
): boolean {
  if (!hold || hold.customerResponsible !== true) return false;
  if (hold.reasonCode === 'PRODUCT_DAMAGED') return false;
  return hold.resolvedAt === null || hold.resolvedAt === undefined;
}

/** 상품 파손 보류 주문에서 배송 재개 버튼 대신 보이는 안내. */
export const DRIVER_NON_REDELIVERABLE_HOLD_MESSAGE =
  '상품을 가게로 돌려주세요. 판매자가 확인한 뒤 주문을 취소·환불해요.';

/**
 * 보류 주문을 기사가 다시 배송할 수 있는 보류인가. 상품 파손(PRODUCT_DAMAGED)은 다시 배송하지 않고
 * 판매자 취소·환불로만 끝나므로 서버가 배송 재개를 거절한다(apps/api/src/orders/orders.helpers.ts
 * deliveryTransitionViolation, @greenhub/shared NON_REDELIVERABLE_HOLD_REASONS). 앱 간 import 없이
 * 순수 함수로 두므로 재배송하지 않는 사유가 늘면 함께 바꾼다.
 */
export function isDriverHoldResumable(hold: { reasonCode?: unknown } | null | undefined): boolean {
  return hold?.reasonCode !== 'PRODUCT_DAMAGED';
}

/**
 * 주문 없음(NOT_FOUND) 화면 안내(D-17). 기사 상세 GET은 본인 배정이거나 아직 아무도 맡지 않은
 * 진행 중 주문만 보이므로, 404는 대개 다른 기사가 맡았거나 완료·취소된 주문이다.
 */
export const DRIVER_ORDER_NOT_FOUND_SCREEN_MESSAGE = '다른 기사가 맡았거나 이미 끝난 주문이에요.';

/** 이 기기에서 방금 완료한 주문을 다시 열었을 때(완료 직후 뒤로가기, R-01)의 안내. */
export const DRIVER_ORDER_COMPLETED_SCREEN_MESSAGE = '배송을 마친 주문이에요.';

/**
 * 주문 없음 화면의 안내와 "배송 목록으로" 이동 탭.
 * 방금 완료한 주문(recent-completion.ts 기억)이면 완료 안내 + 배송 중 탭, 아니면 D-17 안내 + 기본 탭이다.
 */
export function resolveDriverOrderNotFoundScreen(args: { recentlyCompleted: boolean }): {
  message: string;
  listHref: string;
} {
  return args.recentlyCompleted
    ? { message: DRIVER_ORDER_COMPLETED_SCREEN_MESSAGE, listHref: '/board?tab=delivering' }
    : { message: DRIVER_ORDER_NOT_FOUND_SCREEN_MESSAGE, listHref: '/board' };
}

/** 상세에서 목록으로 돌아갈 때 주문 상태에 맞는 탭. 배송 중·보류는 배송 중 탭, 그 밖은 기본(수거 대기) 탭이다. */
export function driverDetailListHref(status: string | null | undefined): string {
  return status === 'DELIVERING' || status === 'DELIVERY_HELD' ? '/board?tab=delivering' : '/board';
}

/**
 * 상세 뒤로가기 판정 입력. 소비자 앱 `lib/nav-back.ts`·판매자 앱 `components/inAppNavigation.ts`와 같은 근거를 쓴다.
 * - canGoBack: Navigation API `navigation.canGoBack`(바로 앞 기록이 같은 출처인지). 지원하지 않으면 undefined.
 * - historyLength: `history.length`(같은 탭에서 앞서 본 다른 사이트도 센다).
 * - referrer·origin: 처음 연 문서가 같은 출처에서 왔는지.
 * - onLandingPage: 이 문서를 처음 연 경로에 아직 머물러 있는지(앱 안 이동을 아직 하지 않았는지).
 * - currentPathname: 지금 화면 경로.
 * - previousPathname: Navigation API로 읽은 바로 앞 기록 경로. 지원하지 않거나 읽지 못하면 undefined.
 */
export interface DriverDetailBackContext {
  canGoBack?: boolean;
  historyLength: number;
  referrer: string;
  origin: string;
  onLandingPage: boolean;
  currentPathname?: string;
  previousPathname?: string;
}

// 로그인 화면 경로(`lib/login-redirect.ts`의 DRIVER_LOGIN_PATH와 같은 값). 이 파일은 node:test가 직접
// 불러오므로 '@/' 별칭을 쓰지 않고 값을 둔다.
const DRIVER_LOGIN_PATHNAME = '/login';

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function isSameOriginReferrer(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

/**
 * 뒤로가기를 브라우저 기록(back)으로 할지, 목록으로 바꿔 보낼지(list) 정한다(D-16).
 * 알림·메신저 링크로 상세를 처음 열면 앱 안 이전 기록이 없어 router.back()이 앱 밖(빈 화면)으로 나가거나
 * 아무 반응이 없다. 확실하지 않으면 앱 밖으로 나가지 않는 쪽(list)으로 닫는다.
 *
 * 알려진 한계:
 * - Navigation API가 없는 브라우저(iOS Safari 일부 등)는 history.length·referrer로 추정한다.
 *   history.length는 같은 탭에서 앞서 본 다른 사이트와 앞으로 가기 기록도 센다.
 * - referrer는 Referrer-Policy·홈 화면 바로가기 실행에서 비어 있을 수 있다. 처음 연 화면에서 비어 있으면 list로 보낸다.
 * - 앱 안에서 다른 화면을 들렀다가 처음 연 상세 경로로 돌아오면(예: 상세 → 사진 → 뒤로) 처음 연 화면으로 보고
 *   referrer로 판정한다. 이때 list로 가도 앱 안에 머문다.
 *
 * 세션이 끝나 다시 로그인한 뒤(callbackUrl 복귀) 바로 앞 기록이 로그인 화면이면 back은 /login으로 가고,
 * 로그인한 기사라 proxy가 같은 화면으로 다시 보내 제자리를 맴돈다. 세션 종료 로그아웃이 남긴 같은 화면 기록으로
 * 가도 같은 화면이 다시 뜰 뿐이다. 두 경우 모두 list(부모 화면 replace)로 보낸다. Navigation API가 없으면
 * 처음 연 화면의 referrer가 로그인 화면일 때만 알아챈다(카카오 로그인은 다른 출처를 거쳐 referrer에 경로가 남지
 * 않을 수 있다).
 */
export function resolveDriverDetailBackAction(context: DriverDetailBackContext): 'back' | 'list' {
  if (typeof context.canGoBack === 'boolean') {
    if (!context.canGoBack) return 'list';
    const previous = context.previousPathname;
    if (
      previous !== undefined &&
      (previous === DRIVER_LOGIN_PATHNAME || previous === context.currentPathname)
    ) {
      return 'list';
    }
    return 'back';
  }
  if (context.historyLength <= 1) return 'list';
  // document.referrer는 앱 안 이동으로 바뀌지 않으므로 처음 연 화면일 때만 본다.
  if (context.onLandingPage) {
    if (!isSameOriginReferrer(context.referrer, context.origin)) return 'list';
    if (pathnameOf(context.referrer) === DRIVER_LOGIN_PATHNAME) return 'list';
  }
  return 'back';
}

type DriverDetailBackBrowser = {
  history: { length: number };
  location: { origin: string; pathname: string };
  document: { referrer: string };
  navigation?: {
    canGoBack?: unknown;
    currentEntry?: { index?: unknown } | null;
    entries?: () => ArrayLike<{ url?: unknown }>;
  };
  performance?: { getEntriesByType?: (type: string) => ArrayLike<{ name: string }> };
};

/** Navigation API로 바로 앞 기록의 경로를 읽는다(같은 출처 기록만 보인다). 읽지 못하면 undefined. */
function readPreviousPathname(
  navigation: DriverDetailBackBrowser['navigation'],
): string | undefined {
  try {
    const index = navigation?.currentEntry?.index;
    if (typeof index !== 'number' || index < 1) return undefined;
    const url = navigation?.entries?.()[index - 1]?.url;
    if (typeof url !== 'string') return undefined;
    return pathnameOf(url) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 브라우저 값을 읽어 판정 입력을 만든다. 처음 연 경로를 읽지 못하면 처음 연 화면으로 본다(앱 밖으로 나가지 않는 쪽). */
export function readDriverDetailBackContext(win: DriverDetailBackBrowser): DriverDetailBackContext {
  const canGoBack = win.navigation?.canGoBack;
  let onLandingPage = true;
  try {
    const entry = win.performance?.getEntriesByType?.('navigation')?.[0];
    if (entry) onLandingPage = new URL(entry.name).pathname === win.location.pathname;
  } catch {
    onLandingPage = true;
  }
  return {
    canGoBack: typeof canGoBack === 'boolean' ? canGoBack : undefined,
    historyLength: win.history.length,
    referrer: win.document.referrer,
    origin: win.location.origin,
    onLandingPage,
    currentPathname: win.location.pathname,
    previousPathname: readPreviousPathname(win.navigation),
  };
}

/** 상품 수: 상품 목록 수량 합계, 목록이 없거나 어긋나면 주문 전체 수량. 둘 다 없으면 null(지어내지 않는다). */
export function driverOrderItemCount(
  items: unknown,
  quantity: number | null | undefined,
): number | null {
  if (Array.isArray(items) && items.length > 0) {
    const quantities = items.map((item) => (item as { quantity?: unknown } | null)?.quantity);
    if (
      quantities.every((value) => typeof value === 'number' && Number.isInteger(value) && value > 0)
    ) {
      return (quantities as number[]).reduce((sum, value) => sum + value, 0);
    }
  }
  return typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0
    ? quantity
    : null;
}

/** 확인 창을 거치는 상태 변경. START: 수거 대기 → 배송 중, RESUME: 배송 보류 → 배송 중. */
export type DriverStatusConfirmKind = 'START' | 'RESUME';

const CONFIRM_FROM_STATUS: Record<DriverStatusConfirmKind, string> = {
  START: 'PREPARING',
  RESUME: 'DELIVERY_HELD',
};

/**
 * 확인 창이 아직 유효한가. 창을 연 사이 조회로 주문 상태가 바뀌면(다른 기기·판매자 처리 등)
 * 그 창의 확인으로 요청을 보내지 않도록 창을 닫는다. 실제 허용 판정은 여전히 서버가 한다.
 */
export function isDriverStatusConfirmCurrent(
  kind: DriverStatusConfirmKind | null,
  status: string | null | undefined,
): boolean {
  return kind !== null && status === CONFIRM_FROM_STATUS[kind];
}

export interface DriverStatusConfirmContent {
  title: string;
  /** 동·호수(나눌 수 없으면 전체 주소, 거점은 거점 이름). */
  place: string;
  /** 동·호수 위에 작게 쓰는 기본 주소. 나눌 수 없으면 null. */
  placeBase: string | null;
  /** "상품 총 N개". 수량을 모르면 null. */
  itemsLine: string | null;
  /** 손님에게 가는 알림. */
  notice: string;
  /** 처음 맡는 주문의 배정 안내. 이미 내 주문이면 null. */
  assignment: string | null;
  confirmLabel: string;
}

/**
 * 배송 시작·재개 확인 창 문구(D-02). 이 전환은 손님 알림을 보내고(PREPARING → DELIVERING: 배송 시작,
 * DELIVERY_HELD → DELIVERING: 재배송 일정, apps/api/src/orders/orders.helpers.ts NOTIFICATION_MAP)
 * 기사 화면에서 되돌릴 수 없으므로 확인을 받는다.
 *
 * 배정 안내: 미배정 주문은 배송 시작 때 요청한 기사에게 배정된다. 상세 응답에 배정 여부(`assignedToMe`)가
 * 없으면 단정하지 않고 중립 표현을 쓴다. 보류 주문은 본인 배정 주문만 보이므로 재개에는 배정 안내가 없다.
 */
export function buildDriverStatusConfirmContent(args: {
  kind: DriverStatusConfirmKind;
  address: { base: string; detail: string | null };
  itemCount: number | null;
  assignedToMe?: boolean | null;
}): DriverStatusConfirmContent {
  const { kind, address, itemCount } = args;
  const place = address.detail ?? address.base;
  const placeBase = address.detail ? address.base : null;
  const itemsLine = itemCount !== null ? `상품 총 ${itemCount}개` : null;
  if (kind === 'RESUME') {
    return {
      title: '배송을 다시 시작할까요?',
      place,
      placeBase,
      itemsLine,
      notice: '손님에게 재배송 일정 알림이 가요.',
      assignment: null,
      confirmLabel: '배송 재개',
    };
  }
  const assignment =
    args.assignedToMe === true
      ? null
      : args.assignedToMe === false
        ? '아직 아무도 맡지 않은 주문이에요. 시작하면 내 배송으로 배정돼요.'
        : '이 주문을 맡아 배송을 시작해요.';
  return {
    title: '배송을 시작할까요?',
    place,
    placeBase,
    itemsLine,
    notice: '손님에게 배송 시작 알림이 가요.',
    assignment,
    confirmLabel: '배송 시작',
  };
}
