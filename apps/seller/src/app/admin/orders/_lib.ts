import { type OrderStatus, POST_DELIVERY_REFUNDABLE_STATUSES } from '@greenhub/shared';

// 주문 상태 라벨/색 — orders 탭 표현 SSOT(테이블·카드·필터 공용).
// Record<OrderStatus>라 공유 상태가 늘면 라벨 누락을 컴파일 단계에서 잡는다.
export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: '결제 대기',
  RECRUITING: '모집 중',
  ACCEPTED: '접수됨',
  CONFIRMED: '확정',
  PREPARING: '준비 중',
  DELIVERING: '배송 중',
  DELIVERY_HELD: '배송 보류',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  REVIEWED: '후기 작성',
  CANCELLED: '취소',
};

// 상태 점의 색(design-direction.md §5 어드민 "상태"): 문제(배송 보류)=빨강, 끝남(취소·결제 대기)=회색, 나머지 검정.
export function getStatusTone(status: OrderStatus): 'problem' | 'done' | 'default' {
  if (status === 'DELIVERY_HELD') return 'problem';
  if (status === 'CANCELLED' || status === 'PENDING') return 'done';
  return 'default';
}

// 상태 탭 — 서버 상태 필터는 한 상태만 받는다(GET /admin/orders?status=). 묶음 탭과 상태별 건수는 API가 없어
// 탭에 숫자를 쓰지 않는다(API 제안: 상태별 건수·묶음 필터). 그 밖 상태는 "전체"에서만 보인다.
export const ORDER_STATUS_TABS: ReadonlyArray<{ key: '' | OrderStatus; label: string }> = [
  { key: '', label: '전체' },
  { key: 'DELIVERY_HELD', label: '배송 보류' },
  { key: 'PENDING', label: '결제 대기' },
  { key: 'PREPARING', label: '준비 중' },
  { key: 'DELIVERING', label: '배송 중' },
  { key: 'DELIVERED', label: '배송 완료' },
  { key: 'CANCELLED', label: '취소' },
];

// 강제환불 버튼 노출 — 서버(admin.service forceRefund)가 허용하는 상태와 같게 유지한다.
// 회차 주문(schemaVersion 2 + roundId): round-order-lifecycle.service claimCancellation 허용 상태.
const ROUND_REFUNDABLE: readonly string[] = [
  'PENDING',
  'ACCEPTED',
  'RECRUITING',
  'CONFIRMED',
  'PREPARING',
  'DELIVERY_HELD',
];
// 일반 주문: orders.helpers getAllowedTransitions('admin')가 CANCELLED를 허용하는 상태.
const LEGACY_REFUNDABLE: readonly string[] = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];

export function isRoundOrder(order: { schemaVersion?: number; roundId?: string | null }): boolean {
  return order.schemaVersion === 2 && !!order.roundId;
}

export function isRefundable(order: {
  status: string;
  schemaVersion?: number;
  roundId?: string | null;
}): boolean {
  const allowed = isRoundOrder(order) ? ROUND_REFUNDABLE : LEGACY_REFUNDABLE;
  return allowed.includes(order.status);
}

// 배송 후 환불 버튼 노출 — 배송 완료로 표시된 회차 주문(서버 PostDeliveryRefundService와 같은 상태).
// 관리자는 기간·정산 조건 없이 환불할 수 있다(지급 완료 정산이면 회수 대기로 표시됨).
export function isPostDeliveryRefundable(order: {
  status: OrderStatus;
  schemaVersion?: number;
  roundId?: string | null;
  postDeliveryRefund?: unknown;
}): boolean {
  return (
    isRoundOrder(order) &&
    !order.postDeliveryRefund &&
    POST_DELIVERY_REFUNDABLE_STATUSES.includes(order.status)
  );
}

// Admin 주문 목록 read state — 조회 실패와 성공-empty의 구조적 구분.
// useAdminOrders는 error/reload를 노출하지만 화면이 이를 소비하지 않으면
// 조회 실패가 빈 목록("주문이 없습니다.")으로 collapse된다.
// 분기 우선순위(loading > error > empty > results)를 순수 함수로 고정한다.
export type AdminOrdersReadState = 'LOADING' | 'FETCH_ERROR' | 'EMPTY' | 'HAS_RESULTS';

export function getAdminOrdersReadState(args: {
  loading: boolean;
  error: string | null;
  orders: readonly unknown[];
}): AdminOrdersReadState {
  if (args.loading) return 'LOADING';
  if (args.error !== null) return 'FETCH_ERROR';
  if (args.orders.length === 0) return 'EMPTY';
  return 'HAS_RESULTS';
}

// 강제환불 확인창 대상 표시 — 운영자가 어느 주문을 얼마 환불하는지 눈으로 확인하게 한다.
// 주문번호가 없는 옛 주문은 목록처럼 줄이지 않고 전체 id를 보여 준다(오인 방지).
export function describeRefundTarget(order: {
  id: string;
  orderNumber?: string | null;
  totalAmount: number;
}): { orderLabel: string; amountLabel: string } {
  return {
    orderLabel: order.orderNumber ?? order.id,
    amountLabel: `₩${order.totalAmount.toLocaleString()}`,
  };
}

// 환불 사유 최대 길이 — API ForceRefundDto(ADMIN_REFUND_REASON_MAX_LENGTH)와 같게 유지한다.
// 넘으면 서버가 400으로 환불 자체를 거절하므로 입력 단계에서 막는다.
export const REFUND_REASON_MAX_LENGTH = 500;

// 환불 사유는 선택 입력 — 비우면 서버 기본 사유('관리자 강제 환불')를 쓰도록 보내지 않는다.
export function normalizeRefundReason(input: string): string | undefined {
  const reason = input.trim();
  return reason ? reason.slice(0, REFUND_REASON_MAX_LENGTH) : undefined;
}

// 주문일시 표기(KST, YYYY-MM-DD HH:mm). API는 ISO 문자열을, 옛 응답은 `{ _seconds }`를 줄 수 있다.
export function formatOrderedAt(createdAt: unknown): string {
  let millis: number | null = null;
  if (typeof createdAt === 'string' && createdAt.trim() !== '') {
    millis = new Date(createdAt).getTime();
  } else if (createdAt && typeof createdAt === 'object' && '_seconds' in createdAt) {
    const seconds = (createdAt as { _seconds: unknown })._seconds;
    if (typeof seconds === 'number') millis = seconds * 1000;
  }
  if (millis === null || Number.isNaN(millis)) return '—';
  const kst = new Date(millis + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(
    kst.getUTCHours(),
  )}:${pad(kst.getUTCMinutes())}`;
}

// 취소 진행 상태 — 환불이 진행 중이거나 실패해 사람이 봐야 하는 주문만 상태 옆에 점 + 글자로 더한다.
// COMPLETED(취소 끝)와 값 없음은 그리지 않는다(상태 '취소'로 충분). 실패는 문제(빨강)다.
const CANCELLATION_STATE: Record<string, { label: string; tone: 'problem' | 'default' }> = {
  REFUNDING: { label: '환불 진행 중', tone: 'default' },
  REFUND_FAILED: { label: '환불 실패', tone: 'problem' },
  LOCAL_PENDING: { label: '취소 처리 중', tone: 'default' },
  LOCAL_FAILED: { label: '취소 마무리 실패', tone: 'problem' },
};

export function cancellationState(
  status: string | null | undefined,
): { label: string; tone: 'problem' | 'default' } | null {
  return status ? (CANCELLATION_STATE[status] ?? null) : null;
}

// 확인할 일 줄 — 불러온 행 중 배송 보류·환불 실패(취소 마무리 실패 포함) 건수. 둘 다 0이면 null(줄을 그리지 않음).
export function countOrderAttention(
  orders: ReadonlyArray<{ status: OrderStatus; cancellationStatus?: string | null }>,
): { held: number; refundFailed: number } | null {
  let held = 0;
  let refundFailed = 0;
  for (const order of orders) {
    if (order.status === 'DELIVERY_HELD') held += 1;
    if (cancellationState(order.cancellationStatus)?.tone === 'problem') refundFailed += 1;
  }
  return held + refundFailed > 0 ? { held, refundFailed } : null;
}

// 행 동작(design-direction.md §5 어드민 "행 동작"·"적용 때 정한 것"):
// - 처리가 필요한 행(환불할 수 있는 배송 보류)에만 보이는 글자 버튼 "환불"을 둔다. 환불 실패는 표시만 한다(다시 시도 동작 없음).
// - 그 밖의 환불(결제 전 주문은 "주문 취소…")과 배송 완료 회차 주문의 "배송 후 환불…"은 행 끝 ⋮ 메뉴에 넣는다.
export type OrderRowAction = 'refund' | 'post-delivery-refund';

export function orderRowActions(order: {
  status: OrderStatus;
  schemaVersion?: number;
  roundId?: string | null;
  postDeliveryRefund?: unknown;
}): {
  primary: OrderRowAction | null;
  menu: Array<{ action: OrderRowAction; label: string }>;
} {
  const refundable = isRefundable(order);
  const primary: OrderRowAction | null =
    refundable && order.status === 'DELIVERY_HELD' ? 'refund' : null;
  const menu: Array<{ action: OrderRowAction; label: string }> = [];
  if (refundable && primary === null) {
    menu.push({ action: 'refund', label: order.status === 'PENDING' ? '주문 취소…' : '환불…' });
  }
  if (isPostDeliveryRefundable(order)) {
    menu.push({ action: 'post-delivery-refund', label: '배송 후 환불…' });
  }
  return { primary, menu };
}

/** 가게 이름 — 잘린 시스템 id를 보여 주지 않는다(D7 "식별"). 이름이 없으면 "이름 없는 가게". */
export function storeLabel(order: { storeId: string; storeName?: string | null }): string {
  return order.storeName?.trim() || '이름 없는 가게';
}

// 가게 선택 옵션 — '전체 가게' + 이름순. 치운 가게는 이름 뒤에 표시해 구분한다.
export function buildStoreOptions(
  stores: ReadonlyArray<{ id: string; name: string; status: string }>,
): { value: string; label: string }[] {
  const options = stores
    .map((store) => ({
      value: store.id,
      label: `${store.name?.trim() || `(미설정) ${store.id.slice(0, 8)}`}${
        store.status === 'archived' ? ' (치움)' : ''
      }`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  return [{ value: '', label: '전체 가게' }, ...options];
}
