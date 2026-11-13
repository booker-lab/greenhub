// 오늘 완료 내역 한 행의 표시 값. 손님 문의에 답할 때 찾기 쉽도록 동·호수를 크게, 기본 주소를 작게 쓰고
// 완료 시각(서울)·상태·상품 요약을 붙인다. 손님 이름·전화는 응답에도 화면에도 없다.
import { splitDeliveryAddress } from '../../../../lib/address-parts';
import {
  type DriverCompletedOrder,
  driverCompletedStatusLabel,
  formatSeoulClock,
} from '../../../../lib/driver-completed-today';
import { orderItemsLabel, orderItemsSummary } from '../../../../lib/order-quantity';

export type CompletedRowView = {
  /** 크게 쓰는 줄: 동·호수. 나눌 수 없으면 전체 주소. */
  primary: string;
  /** 작게 쓰는 기본 주소. 동·호수를 나누지 못했으면 null. */
  secondary: string | null;
  /** 서울 시간 "HH:mm". 읽을 수 없으면 null. */
  time: string | null;
  /** 구매확정·환불됨. 배송 완료는 null. */
  statusLabel: string | null;
  /** "첫 상품 외 n종 · 총 N개" 또는 "상품 · 총 N개". */
  itemsText: string;
};

export function buildCompletedRowView(order: DriverCompletedOrder): CompletedRowView {
  const parts = splitDeliveryAddress(order.address, order.deliveryAddress?.address) ?? {
    base: order.address,
    detail: null,
  };
  return {
    primary: parts.detail ?? parts.base,
    secondary: parts.detail ? parts.base : null,
    time: formatSeoulClock(order.deliveredAt),
    statusLabel: driverCompletedStatusLabel(order.status),
    itemsText: orderItemsSummary(order.items) ?? orderItemsLabel(order.productName, order.quantity),
  };
}
