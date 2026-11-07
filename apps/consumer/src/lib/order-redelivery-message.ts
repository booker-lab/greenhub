/**
 * 주문 상세 재배송비 결제의 고객 문구.
 *
 * 결제창 실패·취소 응답과 모바일 리다이렉트 복귀 쿼리의 `code`·`message`는 PG 원문이 섞여 온다.
 * 원문은 취소인지 가르는 데에만 쓰고(`payment-failure-message.ts`와 같은 규칙) 화면에는 쓰지 않는다.
 * 결과를 아직 모를 때는 내부 동작 설명 대신 고객 문구 하나로 '상태 다시 확인'을 안내한다.
 */
import {
  PAYMENT_CANCELED_MESSAGE,
  type PaymentFailureInput,
  paymentFailureMessage,
} from '@/lib/payment-failure-message';
import type { PaymentRedirectResult, RedeliveryPaymentReturn } from '@/lib/payment-redirect';

export const REDELIVERY_PAYMENT_CANCELED_MESSAGE = '재배송비 결제를 취소했어요.';
export const REDELIVERY_PAYMENT_NOT_COMPLETED_MESSAGE =
  '재배송비 결제가 완료되지 않았어요. 다시 결제해 주세요.';
// 결제 결과를 아직 모를 때. 화면에서 '상태 다시 확인' 안내와 함께 보인다.
export const REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE = '재배송비 결제가 됐는지 아직 확인하지 못했어요.';
// 결제 기록이 실패·환불 상태이거나 복구가 필요해 손님이 다시 결제할 수 없을 때. 주문 상세 하단에 고객센터가 있다.
export const REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE =
  '재배송비 결제 상태를 확인하지 못했어요. 아래 고객센터로 문의해 주세요.';

/** 재배송비 결제창 실패 응답을 고객 문구로 바꾼다. 원문 코드·메시지는 돌려주지 않는다. */
export function redeliveryPaymentFailureMessage(failure: PaymentFailureInput): string {
  return paymentFailureMessage(failure) === PAYMENT_CANCELED_MESSAGE
    ? REDELIVERY_PAYMENT_CANCELED_MESSAGE
    : REDELIVERY_PAYMENT_NOT_COMPLETED_MESSAGE;
}

/**
 * 모바일 재배송비 결제 복귀 판정(`resolveRedeliveryPaymentReturn`)의 문구를 고객 문구로 바꾼다.
 * 판정(kind)은 그대로 두고, 실패·취소는 복귀 쿼리의 원문 대신 위 규칙의 문구로, 결과를 모르면 확인 안내 문구로 보인다.
 */
export function customerRedeliveryPaymentReturn(
  result: PaymentRedirectResult,
  outcome: RedeliveryPaymentReturn,
): RedeliveryPaymentReturn {
  if (outcome.kind === 'rejected') {
    return {
      kind: 'rejected',
      message:
        result.kind === 'failure'
          ? redeliveryPaymentFailureMessage({ code: result.code, message: result.message })
          : REDELIVERY_PAYMENT_NOT_COMPLETED_MESSAGE,
    };
  }
  if (outcome.kind === 'uncertain') {
    return { kind: 'uncertain', message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE };
  }
  return outcome;
}
