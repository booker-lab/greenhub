/**
 * Driver list (Board/Map) read pure contract helper.
 *
 * Board(`board/_client.tsx`)와 Map(`map/page.tsx`)이 같은 목록 read
 * semantics를 공유하기 위한 최소 소유자다. Detail helper
 * (`board/_lib/driver-order-detail.ts`)를 건드리지 않고 목록 범위에만 적용한다.
 *
 * - 목록 GET의 HTTP status 분류 (401·403 / 그 외·network)
 * - user identity + role + access token scope identity
 * - 실패 때 이전 protected rows를 유지해도 되는지에 대한 단일 판정
 *
 * Server mutation policy를 재정의하지 않으며 raw Firestore read나
 * payment 의미 재조합을 도입하지 않는다.
 */

export type DriverListReadErrorKind = 'AUTH_ERROR' | 'FETCH_ERROR';

export class DriverListReadError extends Error {
  readonly kind: DriverListReadErrorKind;
  readonly status: number | null;

  constructor(kind: DriverListReadErrorKind, status: number | null, message: string) {
    super(message);
    this.name = 'DriverListReadError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * 목록 GET의 HTTP status를 두 의미로 분류한다.
 * 401·403은 authority loss이며 그 외 HTTP 실패는 transient fetch 실패다.
 * 목록 GET에 authoritative absence(404) 계약은 없으므로 404는 FETCH_ERROR로 둔다.
 */
export function classifyDriverListReadStatus(status: number): DriverListReadErrorKind {
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  return 'FETCH_ERROR';
}

export function toDriverListReadError(
  status: number,
  fallbackMessage = '주문을 불러오지 못했습니다',
): DriverListReadError {
  const kind = classifyDriverListReadStatus(status);
  if (kind === 'AUTH_ERROR') {
    return new DriverListReadError(kind, status, '로그인이 필요합니다. 세션을 다시 확인해 주세요.');
  }
  return new DriverListReadError(kind, status, fallbackMessage);
}

export function toDriverListNetworkError(
  fallbackMessage = '주문을 불러오지 못했습니다',
): DriverListReadError {
  return new DriverListReadError('FETCH_ERROR', null, fallbackMessage);
}

/**
 * catch 진입의 unknown 원인을 목록 read 의미로 정규화한다.
 * typed AUTH/ FETCH error는 kind를 보존하고, 그 외(network·abort 외·malformed)는
 * transient FETCH_ERROR로 취급한다.
 */
export function toDriverListReadErrorKind(cause: unknown): DriverListReadErrorKind {
  if (cause instanceof DriverListReadError) return cause.kind;
  return 'FETCH_ERROR';
}

/**
 * 목록 GET 실패 때 이전 protected rows를 화면에 유지해도 되는가.
 *
 * - AUTH_ERROR(401·403): authority loss이므로 절대 유지하지 않는다.
 * - FETCH_ERROR(network/5xx·malformed 등): 같은 scope에서 이미 성공한 read가
 *   있을 때만 이전 내용을 stale로 유지할 수 있다.
 */
export function shouldPreserveDriverListOnReadError(
  kind: DriverListReadErrorKind,
  hasSuccessfulRead: boolean,
): boolean {
  if (!hasSuccessfulRead) return false;
  return kind === 'FETCH_ERROR';
}

/**
 * 목록 read의 최소 scope identity: user identity + role + access token.
 * role은 driver app의 scope authority(proxy gate)라 포함한다.
 * token이 회전해도 같은 user의 이전 scope 잔여물이 새 scope에 남지 않도록
 * token 원문을 포함한다.
 */
export function buildDriverListScope(args: {
  userId?: string | null;
  role?: string | null;
  token: string;
}): string {
  const userId = args.userId && args.userId.length > 0 ? args.userId : '__no_user__';
  const role = args.role && args.role.length > 0 ? args.role : '__no_role__';
  return `${userId}::${role}::${args.token}`;
}
