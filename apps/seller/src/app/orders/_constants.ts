import type { Order, OrderStatus } from '@greenhub/shared';

// ─── OrderGroup 레이어 ───────────────────────────────────────────────────────

export type OrderGroup =
  | 'ACTION_REQUIRED'
  | 'WAITING'
  | 'IN_DELIVERY'
  | 'DONE'
  | 'CANCELLED';

export const STATUS_GROUP_MAP: Record<OrderStatus, OrderGroup> = {
  PENDING:     'ACTION_REQUIRED',
  RECRUITING:  'ACTION_REQUIRED',
  ACCEPTED:    'ACTION_REQUIRED',
  CONFIRMED:   'ACTION_REQUIRED',
  PREPARING:   'WAITING',
  DELIVERING:  'IN_DELIVERY',
  HUB_ARRIVED: 'IN_DELIVERY',
  DELIVERED:   'DONE',
  PICKED_UP:   'DONE',
  REVIEWED:    'DONE',
  CANCELLED:   'CANCELLED',
};

export const GROUP_TABS: { key: OrderGroup; label: string }[] = [
  { key: 'ACTION_REQUIRED', label: '처리 필요' },
  { key: 'WAITING',         label: '대기 중' },
  { key: 'IN_DELIVERY',     label: '배송 중' },
  { key: 'DONE',            label: '완료' },
  { key: 'CANCELLED',       label: '취소' },
];

export const IN_DELIVERY_SUBFILTERS: { key: 'ALL' | 'DELIVERING' | 'HUB_ARRIVED'; label: string }[] = [
  { key: 'ALL',         label: '전체' },
  { key: 'DELIVERING',  label: '배송 중' },
  { key: 'HUB_ARRIVED', label: '거점 도착' },
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: '대기',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '취소',
  REVIEWED: '구매 확정',
};

export const STATUS_COLOR: Record<OrderStatus, string> = {
  ACCEPTED: 'orange',
  CONFIRMED: 'orange',
  RECRUITING: 'orange',
  PREPARING: 'blue',
  DELIVERING: 'violet',
  HUB_ARRIVED: 'violet',
  CANCELLED: 'red',
  PENDING: 'gray',
  DELIVERED: 'green',
  PICKED_UP: 'green',
  REVIEWED: 'green',
};

export const ACCENT_BORDER: Record<OrderStatus, string> = {
  ACCEPTED: 'var(--color-status-warning-text)',
  CONFIRMED: 'var(--color-status-warning-text)',
  RECRUITING: 'var(--color-status-warning-text)',
  PREPARING: 'var(--color-status-info-text)',
  DELIVERING: '#7048e8',
  HUB_ARRIVED: '#7048e8',
  CANCELLED: 'var(--color-danger)',
  PENDING: 'var(--color-text-disabled)',
  DELIVERED: 'var(--color-primary)',
  PICKED_UP: 'var(--color-primary)',
  REVIEWED: 'var(--color-text-disabled)',
};

export const DELIVERY_LABEL: Record<string, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

// ─── 날짜 범위 필터 (T5) ─────────────────────────────────────────────────────

export type DateRangePreset = 'today' | 'week' | 'month' | 'custom';

export const DATE_PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'custom', label: '직접 입력' },
];

/** 아카이브 탭(완료·취소)은 `createdAt`, 그 외 활성 탭은 `requestedDeliveryDate` 기준 */
const ARCHIVE_TABS = new Set<OrderGroup>(['DONE', 'CANCELLED']);

export function isArchiveTab(tab: OrderGroup): boolean {
  return ARCHIVE_TABS.has(tab);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * 필터 기준 날짜를 반환. 활성 탭은 배송 예정일, 아카이브 탭은 주문 생성일.
 * 파싱 불가·null이면 `null` (→ 날짜 필터에서 제외되지 않고 "날짜 미정" 그룹으로 내려감).
 */
export function getOrderDate(order: Order, tab: OrderGroup): Date | null {
  const raw = isArchiveTab(tab) ? order.createdAt : order.requestedDeliveryDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 프리셋·탭에 따른 날짜 범위(inclusive)를 반환. `custom`은 from/to 입력값 사용.
 * 입력이 비었거나 from > to면 `null` (→ 호출부에서 날짜 필터 미적용).
 */
export function getDateRange(
  preset: DateRangePreset,
  tab: OrderGroup,
  customFrom = '',
  customTo = '',
): { from: Date; to: Date } | null {
  const today = startOfDay(new Date());
  const archive = isArchiveTab(tab);

  if (preset === 'today') {
    return { from: today, to: endOfDay(today) };
  }

  if (preset === 'week') {
    if (archive) {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { from, to: endOfDay(today) };
    }
    const to = new Date(today);
    to.setDate(to.getDate() + 6);
    return { from: today, to: endOfDay(to) };
  }

  if (preset === 'month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    return { from, to };
  }

  // custom
  if (!customFrom || !customTo) return null;
  const from = startOfDay(new Date(customFrom));
  const to = endOfDay(new Date(customTo));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from > to) return null;
  return { from, to };
}

// ─── 날짜 그룹 헤더 (T6) ─────────────────────────────────────────────────────

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 로컬 기준 'YYYY-MM-DD' 문자열 (UTC 변환 없이 표시일 기준 그룹핑) */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DateGroup {
  dateKey: string; // 'overdue' | 'YYYY-MM-DD' | 'undated'
  orders: Order[];
}

export interface GroupHeaderMeta {
  label: string;
  urgency: 'overdue' | 'today' | 'normal';
}

/**
 * 필터된 주문을 날짜 그룹으로 분할·정렬.
 * - 'overdue': 배송 예정일 경과 (활성 탭 한정) — 최상단
 * - 'YYYY-MM-DD': 해당 날짜 — 활성 탭 ASC, 아카이브 탭 DESC
 * - 'undated': requestedDeliveryDate = null (공동구매 등) — 최하단
 * 그룹 내 정렬은 활성 탭 createdAt ASC, 아카이브 탭 createdAt DESC.
 */
export function groupOrdersByDate(orders: Order[], tab: OrderGroup): DateGroup[] {
  const archive = isArchiveTab(tab);
  const todayKey = toDateKey(new Date());
  const buckets = new Map<string, Order[]>();

  for (const order of orders) {
    const d = getOrderDate(order, tab);
    let key: string;
    if (!d) {
      key = 'undated';
    } else {
      const dayKey = toDateKey(d);
      key = !archive && dayKey < todayKey ? 'overdue' : dayKey;
    }
    const arr = buckets.get(key);
    if (arr) arr.push(order);
    else buckets.set(key, [order]);
  }

  for (const arr of buckets.values()) {
    arr.sort((a, b) =>
      archive ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
    );
  }

  const entries = [...buckets.entries()];
  entries.sort(([a], [b]) => {
    if (a === 'overdue') return -1;
    if (b === 'overdue') return 1;
    if (a === 'undated') return 1;
    if (b === 'undated') return -1;
    return archive ? b.localeCompare(a) : a.localeCompare(b);
  });

  return entries.map(([dateKey, groupOrders]) => ({ dateKey, orders: groupOrders }));
}

/** 그룹 헤더 라벨·강조 메타 반환 */
export function getGroupHeaderMeta(dateKey: string, archive: boolean): GroupHeaderMeta {
  if (dateKey === 'overdue') return { label: '지연', urgency: 'overdue' };
  if (dateKey === 'undated') return { label: '날짜 미정', urgency: 'normal' };

  const d = new Date(`${dateKey}T00:00:00`);
  const todayKey = toDateKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toDateKey(yesterday);
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;

  if (archive) {
    if (dateKey === todayKey) return { label: '오늘', urgency: 'normal' };
    if (dateKey === yesterdayKey) return { label: '어제', urgency: 'normal' };
    return { label: md, urgency: 'normal' };
  }

  if (dateKey === todayKey) return { label: '오늘 배송', urgency: 'today' };
  return { label: md, urgency: 'normal' };
}

export function formatRelativeTime(iso: unknown): string {
  const date =
    iso && typeof iso === 'object' && 'toDate' in iso
      ? (iso as { toDate(): Date }).toDate()
      : new Date(iso as string);
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
