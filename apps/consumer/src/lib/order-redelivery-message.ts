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
// 결제창을 열기 전(결제 설정 읽기·결제 모듈 불러오기)에 멈췄을 때. 결제창이 열리지 않았으므로 다시 시도를 안내한다.
export const REDELIVERY_PAYMENT_NOT_STARTED_MESSAGE =
  '재배송비 결제를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.';
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

/**
 * 재배송비 결제 흐름의 진행 단계.
 * - requesting: 결제 기록 요청을 보냈거나 그 응답을 읽는 중(요청이 닿았는지 모른다)
 * - opening-window: 결제 기록을 받고 결제창을 열 준비를 하는 중(결제 설정·결제 모듈, 결제창은 아직 안 열림)
 * - paying: 결제창을 불렀다(손님이 결제했을 수 있다)
 * - confirming: 결제창이 끝나 주문의 결제 완료를 다시 읽는 중
 */
export type RedeliveryPaymentStage = 'requesting' | 'opening-window' | 'paying' | 'confirming';

export type RedeliveryPaymentUnexpectedFailure =
  | { kind: 'rejected'; message: string }
  | { kind: 'uncertain'; message: string };

/**
 * 예상하지 못한 예외를 진행 단계로 가른다. 결제창을 열기 전에 멈췄으면 결제가 시작되지 않았으므로
 * '시작하지 못했어요'로 다시 시도를 안내하고, 그 밖의 단계는 결제됐을 수 있으므로 중복 결제를 막기 위해
 * '확인하지 못했어요'와 '상태 다시 확인'을 안내한다.
 */
export function redeliveryPaymentUnexpectedFailure(
  stage: RedeliveryPaymentStage,
): RedeliveryPaymentUnexpectedFailure {
  if (stage === 'opening-window') {
    return { kind: 'rejected', message: REDELIVERY_PAYMENT_NOT_STARTED_MESSAGE };
  }
  return { kind: 'uncertain', message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE };
}
