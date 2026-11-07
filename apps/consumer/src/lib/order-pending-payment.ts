/**
 * 결제 확인 중(PENDING) 주문의 고객 안내 문구.
 *
 * 결제창을 닫거나 결제를 끝내지 않은 시도도 PENDING 주문으로 남는다. 늦게 도착한 결제가 확정될 수 있어
 * 목록에서 숨기지 않고, 상태 이름('결제 확인 중')도 그대로 둔다(결제 직후 확정 전 몇 초도 같은 상태다).
 * 대신 MY 주문 목록 카드와 주문 상세에 짧은 설명을 붙여 실제 접수된 주문과 구분해 보이게 한다.
 *
 * 자동 취소 시각은 숫자로 쓰지 않는다. API 정리 작업(payments.service.ts cleanupPendingOrders)은 만든 지
 * 15분이 지난 PENDING 주문을 매분 확인해 취소하지만, 결제사 조회가 실패하면 그 회차에는 취소하지 않고
 * 다음 확인으로 넘어가므로 정확한 시각을 약속할 수 없다.
 */

// 결제를 끝내지 않은 시도가 어떻게 정리되는지. 목록 카드와 상세가 같은 문장을 쓴다.
export const PENDING_PAYMENT_AUTO_CANCEL_NOTICE =
  '결제를 마치지 않았다면 잠시 뒤 자동으로 취소돼요.';
// 주문 상세에서 배송 현황 단계 대신 보이는 문장. 결제가 확정되기 전에는 배송 단계가 시작되지 않는다.
export const PENDING_PAYMENT_TIMELINE_NOTICE = '결제가 확인되면 배송 현황이 보여요.';
// 주문 상세의 다음 행동 안내. 결제를 끝내지 않은 회차 상품은 장바구니에서 빠지지 않는다(결제 완료 때만 뺀다).
export const PENDING_PAYMENT_RETRY_HINT = '다시 주문하려면 장바구니에서 결제해 주세요.';
export const PENDING_PAYMENT_CART_LABEL = '장바구니로 가기';
export const PENDING_PAYMENT_CART_HREF = '/cart';

export interface PendingPaymentDetailGuide {
  autoCancelNotice: string;
  timelineNotice: string;
  retryHint: string;
  cartLabel: string;
  cartHref: string;
}

/** 결제가 아직 확정되지 않은(PENDING) 주문인지. */
export function isPaymentPendingOrder(status: unknown): boolean {
  return status === 'PENDING';
}

/** MY 주문 목록 카드에 붙일 설명 한 줄. 결제 확인 중 주문이 아니면 null. */
export function orderListPendingPaymentNotice(status: unknown): string | null {
  return isPaymentPendingOrder(status) ? PENDING_PAYMENT_AUTO_CANCEL_NOTICE : null;
}

/**
 * 주문 상세의 결제 확인 중 안내(배송 현황 대신 보일 문장·자동 취소 설명·장바구니로 가기).
 * 결제 확인 중 주문이 아니거나 이미 취소된 것으로 보이는 주문이면 null.
 */
export function orderDetailPendingPaymentGuide(
  status: unknown,
  options: { cancelled: boolean },
): PendingPaymentDetailGuide | null {
  if (options.cancelled || !isPaymentPendingOrder(status)) return null;
  return {
    autoCancelNotice: PENDING_PAYMENT_AUTO_CANCEL_NOTICE,
    timelineNotice: PENDING_PAYMENT_TIMELINE_NOTICE,
    retryHint: PENDING_PAYMENT_RETRY_HINT,
    cartLabel: PENDING_PAYMENT_CART_LABEL,
    cartHref: PENDING_PAYMENT_CART_HREF,
  };
}
