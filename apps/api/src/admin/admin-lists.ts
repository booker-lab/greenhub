import { BadRequestException } from '@nestjs/common';
import type { FirestoreService } from '../firestore/firestore.service';

// 관리자 목록 응답(판매자·주문·기사)의 허용 필드와 이어받기(커서) 규칙.
// 저장 문서를 통째로 내려주지 않고 화면이 쓰는 필드만 고른다(배송지·세션·정산 계좌 등 제외).

/** 이어받기 위치 = 앞 응답의 마지막 문서 id. 경로 구분자는 받지 않는다. */
export const ADMIN_LIST_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const ADMIN_LIST_CURSOR_MESSAGE = 'cursor 값이 올바르지 않습니다';

export const ADMIN_ORDER_LIST_DEFAULT_LIMIT = 50;
export const ADMIN_ORDER_LIST_MAX_LIMIT = 100;
export const ADMIN_DRIVER_LIST_DEFAULT_LIMIT = 100;
export const ADMIN_DRIVER_LIST_MAX_LIMIT = 200;

/** 생략·잘못된 값은 기본값, 범위를 벗어나면 1~상한으로 맞춘다. */
export function resolveAdminListLimit(raw: unknown, defaultLimit: number, maxLimit: number): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultLimit;
  return Math.min(Math.max(Math.floor(value), 1), maxLimit);
}

export const ADMIN_STORE_LIST_FIELDS = [
  'id',
  'name',
  'status',
  'salesMode',
  'commissionRate',
  'ceoName',
  'phone',
  'createdAt',
  'archivedAt',
] as const;

export const ADMIN_DRIVER_LIST_FIELDS = [
  'id',
  'name',
  'email',
  'phone',
  'driverApproved',
  'suspended',
  'createdAt',
] as const;

export function pickListFields(data: Record<string, unknown>, fields: readonly string[]) {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (data[field] !== undefined) picked[field] = data[field];
  }
  return picked;
}

type OrderLine = { productName?: unknown; quantity?: unknown };

/** 상품 요약: 첫 상품명 + "외 N개". 회차 주문은 orderItems, 일반 주문은 productName 한 개. */
export function summarizeOrderProducts(order: Record<string, unknown>): string | null {
  const lines = Array.isArray(order['orderItems']) ? (order['orderItems'] as OrderLine[]) : [];
  const names = lines
    .map((line) => (typeof line?.productName === 'string' ? line.productName.trim() : ''))
    .filter((name) => name !== '');
  if (names.length > 0) {
    return names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}개`;
  }
  const single = typeof order['productName'] === 'string' ? order['productName'].trim() : '';
  return single || null;
}

/**
 * 관리자 주문 목록 한 줄. 고객은 이름만 싣고 전화·주소·배송지는 싣지 않는다.
 * cancellationStatus는 취소 진행 상태(REFUNDING·REFUND_FAILED 등)를 그대로 옮긴다.
 */
export function toAdminOrderRow(
  order: Record<string, unknown>,
  storeNames: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const storeId = typeof order['storeId'] === 'string' ? order['storeId'] : '';
  const cancellation = order['cancellation'] as Record<string, unknown> | null | undefined;
  return {
    id: order['id'],
    orderNumber: order['orderNumber'] ?? null,
    storeId,
    storeName: storeNames.get(storeId) ?? null,
    status: order['status'],
    totalAmount: typeof order['totalAmount'] === 'number' ? order['totalAmount'] : 0,
    deliveryMethod: order['deliveryMethod'] ?? null,
    createdAt: order['createdAt'] ?? null,
    schemaVersion: order['schemaVersion'] ?? null,
    roundId: order['roundId'] ?? null,
    requestNote: order['requestNote'] ?? null,
    buyerName: typeof order['buyerName'] === 'string' ? order['buyerName'] : null,
    productSummary: summarizeOrderProducts(order),
    cancellationStatus:
      typeof cancellation?.['status'] === 'string' ? cancellation['status'] : null,
  };
}

/** 커서 문서가 없거나 형식이 틀리면 같은 400으로 거절한다(문서 존재 여부를 드러내지 않음). */
export async function readAdminListCursor(
  firestore: FirestoreService,
  collection: 'orders' | 'users',
  cursor: unknown,
  belongs: (data: Record<string, unknown>) => boolean = () => true,
) {
  if (typeof cursor !== 'string' || !ADMIN_LIST_CURSOR_PATTERN.test(cursor)) {
    throw new BadRequestException(ADMIN_LIST_CURSOR_MESSAGE);
  }
  const cursorSnap = await firestore.doc(`${collection}/${cursor}`).get();
  if (!cursorSnap.exists || !belongs(cursorSnap.data() ?? {})) {
    throw new BadRequestException(ADMIN_LIST_CURSOR_MESSAGE);
  }
  return cursorSnap;
}

/** 목록 한 쪽에 나온 가게만 가게마다 한 번씩 읽어 이름을 붙인다. */
export async function readStoreNames(
  firestore: FirestoreService,
  storeIds: unknown[],
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(storeIds.filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  const snaps = await Promise.all(unique.map((id) => firestore.doc(`stores/${id}`).get()));
  const names = new Map<string, string>();
  snaps.forEach((snap, index) => {
    const name = snap.exists ? snap.data()?.['name'] : undefined;
    if (typeof name === 'string' && name.trim() !== '') names.set(unique[index], name);
  });
  return names;
}
