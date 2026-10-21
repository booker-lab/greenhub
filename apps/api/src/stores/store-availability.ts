import { ConflictException } from '@nestjs/common';

/**
 * 치운(archived) 가게의 손님 노출·주문 기준 — 단일 소유.
 *
 * 관리자가 치운 가게는 손님 화면(가게 소개·상품·회차·상품 요청)에서 숨기고 새 주문을 받지 않는다.
 * 문서가 없거나 다른 상태(invited·active·값 없음)는 지금처럼 다룬다. 판매자 로그인·자기 화면은 막지 않는다.
 */
export const ARCHIVED_STORE_STATUS = 'archived';

export const STORE_CLOSED_FOR_ORDERS_MESSAGE = '지금은 주문할 수 없는 가게예요.';

export function isArchivedStore(data: Record<string, unknown> | null | undefined): boolean {
  return data?.['status'] === ARCHIVED_STORE_STATUS;
}

/** 새 주문·장바구니 확인 직전에 부른다. 치운 가게면 손님에게 보이는 문구로 409를 낸다. */
export function assertStoreAcceptsOrders(data: Record<string, unknown> | null | undefined): void {
  if (isArchivedStore(data)) {
    throw new ConflictException(STORE_CLOSED_FOR_ORDERS_MESSAGE);
  }
}
