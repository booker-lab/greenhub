/**
 * 결제창 실패·취소를 고객에게 보일 문구로 바꾼다.
 *
 * PortOne 결제창 응답(PC Promise)과 모바일 리다이렉트 복귀 쿼리의 `code`·`message`는
 * "[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다"처럼 PG 원문 코드가 섞여 온다.
 * 원문은 어떤 경우인지 가르는 데에만 쓰고 화면에는 쓰지 않는다(`payment-redirect.ts`의 pgMessage 규칙과 같다).
 */

export const PAYMENT_CANCELED_MESSAGE = '결제를 취소했어요. 장바구니는 그대로 남아 있어요.';
export const PAYMENT_NOT_COMPLETED_MESSAGE =
  '결제가 완료되지 않았어요. 장바구니는 그대로 남아 있으니 다시 결제해 주세요.';

export interface PaymentFailureInput {
  code?: string | null;
  message?: string | null;
  pgCode?: string | null;
}

// PortOne·PG 취소 코드(PAY_PROCESS_CANCELED, USER_CANCEL 등)와 "취소" 원문 메시지를 취소로 본다.
const CANCEL_CODE_PATTERN = /CANCEL/i;

function isCanceled({ code, message, pgCode }: PaymentFailureInput): boolean {
  return [code, pgCode, message].some(
    (value) =>
      typeof value === 'string' && (CANCEL_CODE_PATTERN.test(value) || value.includes('취소')),
  );
}

/** 결제창 실패 응답을 고객 문구로 바꾼다. 원문 코드·메시지는 돌려주지 않는다. */
export function paymentFailureMessage(failure: PaymentFailureInput): string {
  return isCanceled(failure) ? PAYMENT_CANCELED_MESSAGE : PAYMENT_NOT_COMPLETED_MESSAGE;
}
