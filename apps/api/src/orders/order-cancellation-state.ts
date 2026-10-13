type OrderRecord = Record<string, unknown>;

/**
 * 주문 취소가 시작됐지만 아직 COMPLETED로 끝나지 않은 `cancellation.status` 값.
 * 이 상태의 주문은 취소 orchestration이 상태·환불·재고를 소유하므로 배송 전이나
 * 재배송비 결제 확정 같은 다른 write가 끼어들면 안 된다.
 * 취소를 되돌리는 경로는 없으므로 REFUND_FAILED도 재시도 대기 중인 취소로 본다.
 */
export const CANCELLATION_IN_PROGRESS_STATUSES = [
  'REFUNDING',
  'LOCAL_PENDING',
  'LOCAL_FAILED',
  'REFUND_FAILED',
] as const;

export function isOrderCancellationInProgress(order: OrderRecord | null | undefined): boolean {
  const cancellation = order?.['cancellation'] as OrderRecord | null | undefined;
  const status = cancellation?.['status'];
  return (
    typeof status === 'string' &&
    (CANCELLATION_IN_PROGRESS_STATUSES as readonly string[]).includes(status)
  );
}

/** 이미 취소됐거나 취소가 진행 중인 주문인지 확인한다. */
export function isOrderCancelledOrCancelling(order: OrderRecord | null | undefined): boolean {
  return order?.['status'] === 'CANCELLED' || isOrderCancellationInProgress(order);
}
