// 오늘 완료 내역(`GET /driver/completed-today`)과 완료 사진 주소(`GET /driver/completed-today/:orderId/photo`) 읽기.
// 기사가 손님 문의에 답할 때 오늘(서울 날짜) 마친 배송과 사진을 다시 보는 화면(board/completed)이 쓴다.
//
// - 응답에서 화면이 쓰는 필드만 골라 새 객체로 만든다. 손님 이름·전화 같은 필드는 응답에 섞여 와도 옮기지 않는다.
// - 형식이 어긋난 행은 버린다(지어내지 않는다). 목록 자체가 어긋나면 null이고 화면은 조회 실패로 다룬다.
// - node:test가 이 파일을 직접 불러오므로 다른 모듈을 import하지 않는다.

export type DriverCompletedStatus = 'DELIVERED' | 'REVIEWED' | 'CANCELLED';

export type DriverCompletedItem = { productName: string; quantity: number };

export type DriverCompletedOrder = {
  id: string;
  status: DriverCompletedStatus;
  /** 배송 완료 시각(ISO). */
  deliveredAt: string;
  /** 기본 주소 + 상세 주소(동·호수)를 붙인 전체 주소. */
  address: string;
  deliveryAddress?: { address: string; addressDetail?: string };
  /** 첫 상품 이름. */
  productName: string;
  /** 전체 수량 합계. */
  quantity: number;
  items?: DriverCompletedItem[];
  hasPhoto: boolean;
};

export type DriverCompletedToday = {
  /** 서울 날짜(YYYY-MM-DD). 형식이 어긋나면 null(화면에 쓰지 않는다). */
  date: string | null;
  /** 최근 완료가 먼저다(API 정렬 그대로). */
  orders: DriverCompletedOrder[];
};

export type DriverCompletedPhoto = { url: string; expiresAt: string | null };

const STATUSES: readonly DriverCompletedStatus[] = ['DELIVERED', 'REVIEWED', 'CANCELLED'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function readItems(value: unknown): DriverCompletedItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const items: DriverCompletedItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const productName = nonEmptyString(entry.productName);
    if (productName === null || !isPositiveInteger(entry.quantity)) return undefined;
    items.push({ productName, quantity: entry.quantity });
  }
  return items;
}

function readDeliveryAddress(value: unknown): DriverCompletedOrder['deliveryAddress'] {
  if (!isRecord(value)) return undefined;
  const address = nonEmptyString(value.address);
  if (address === null) return undefined;
  const addressDetail = nonEmptyString(value.addressDetail);
  return addressDetail === null ? { address } : { address, addressDetail };
}

/** 한 행을 읽는다. 필수 필드가 하나라도 어긋나면 null(행을 버린다). 선택 필드만 어긋나면 그 필드만 뺀다. */
export function readDriverCompletedOrder(value: unknown): DriverCompletedOrder | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const status = value.status;
  const deliveredAt = nonEmptyString(value.deliveredAt);
  const address = nonEmptyString(value.address);
  const productName = nonEmptyString(value.productName);
  if (
    id === null ||
    !STATUSES.includes(status as DriverCompletedStatus) ||
    deliveredAt === null ||
    Number.isNaN(Date.parse(deliveredAt)) ||
    address === null ||
    productName === null ||
    !isPositiveInteger(value.quantity) ||
    typeof value.hasPhoto !== 'boolean'
  ) {
    return null;
  }
  const order: DriverCompletedOrder = {
    id,
    status: status as DriverCompletedStatus,
    deliveredAt,
    address,
    productName,
    quantity: value.quantity,
    hasPhoto: value.hasPhoto,
  };
  const deliveryAddress = readDeliveryAddress(value.deliveryAddress);
  if (deliveryAddress) order.deliveryAddress = deliveryAddress;
  const items = readItems(value.items);
  if (items) order.items = items;
  return order;
}

/**
 * 오늘 완료 내역 응답을 읽는다. 목록(orders)이 배열이 아니면 null(조회 실패로 다룬다).
 * 어긋난 행과 같은 id가 다시 나온 행은 버린다.
 */
export function readDriverCompletedToday(payload: unknown): DriverCompletedToday | null {
  if (!isRecord(payload) || !Array.isArray(payload.orders)) return null;
  const date =
    typeof payload.date === 'string' && DATE_PATTERN.test(payload.date) ? payload.date : null;
  const seen = new Set<string>();
  const orders: DriverCompletedOrder[] = [];
  for (const row of payload.orders) {
    const order = readDriverCompletedOrder(row);
    if (!order || seen.has(order.id)) continue;
    seen.add(order.id);
    orders.push(order);
  }
  return { date, orders };
}

/** 상태 글자. 배송 완료(DELIVERED)는 글자를 붙이지 않는다. */
export function driverCompletedStatusLabel(status: DriverCompletedStatus): string | null {
  if (status === 'REVIEWED') return '구매확정';
  if (status === 'CANCELLED') return '환불됨';
  return null;
}

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 완료 시각을 서울 시간 "HH:mm"으로 쓴다. 서울은 일광 절약 시간이 없어 UTC+9 고정으로 계산한다
 * (휴대폰 시간대와 관계없다, lib/delivery-day.ts와 같은 방식). 읽을 수 없으면 null.
 */
export function formatSeoulClock(value: string): string | null {
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) return null;
  const shifted = new Date(millis + SEOUL_OFFSET_MS);
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** 사진 주소 응답을 읽는다. https 주소가 아니면 null(띄우지 않는다). */
export function readDriverCompletedPhoto(payload: unknown): DriverCompletedPhoto | null {
  if (!isRecord(payload)) return null;
  const url = nonEmptyString(payload.url);
  if (url === null) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const expiresAt = nonEmptyString(payload.expiresAt);
  return { url, expiresAt };
}

export type DriverCompletedPhotoReadKind = 'AUTH_ERROR' | 'MISSING' | 'FETCH_ERROR';

/**
 * 사진 주소 조회 실패의 HTTP status 분류. 401·403은 권한 상실(목록과 사진을 모두 지운다),
 * 404는 볼 수 있는 사진이 없음, 그 밖은 일시적 실패다.
 */
export function classifyDriverCompletedPhotoStatus(status: number): DriverCompletedPhotoReadKind {
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status === 404) return 'MISSING';
  return 'FETCH_ERROR';
}
