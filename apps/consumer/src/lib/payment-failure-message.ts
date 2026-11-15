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

// 고객이 결제창을 닫은 경우만 취소로 본다. code·pgCode의 취소 코드(PAY_PROCESS_CANCELED, USER_CANCEL 등),
// 메시지 앞 대괄호 코드("[PAY_PROCESS_CANCELED] ..."), "사용자가 취소"·"결제를 취소" 문장이 그 신호다.
// "취소된 카드입니다"·"거래 취소 불가"처럼 고객이 닫지 않은 PG 실패는 '취소'라는 글자가 있어도 취소로 보지 않는다.
const CANCEL_CODE_PATTERN = /CANCEL/i;
const BRACKETED_CANCEL_CODE_PATTERN = /\[[^\]]*CANCEL[^\]]*\]/i;
const USER_CANCEL_SENTENCE_PATTERN = /결제를\s*취소|사용자가?\s*취소/;

export function isPaymentCanceled({ code, message, pgCode }: PaymentFailureInput): boolean {
  if ([code, pgCode].some((value) => typeof value === 'string' && CANCEL_CODE_PATTERN.test(value))) {
    return true;
  }
  return (
    typeof message === 'string' &&
    (BRACKETED_CANCEL_CODE_PATTERN.test(message) || USER_CANCEL_SENTENCE_PATTERN.test(message))
  );
}

/**
 * 결제 화면 안내의 종류. canceled는 고객이 결제창을 닫은 경우라 문제 상태가 아니고(중립 면),
 * failed는 그 밖의 실패·거절이다(빨강 면, design-standard.md §2 "빨강은 문제 상태에만").
 */
export type PaymentFailureKind = 'canceled' | 'failed';

/** 화면에 보일 문구와 종류를 함께 담는다. 종류를 문구 비교로 다시 가리지 않게 한 값으로 묶는다. */
export interface PaymentFailureNotice {
  kind: PaymentFailureKind;
  message: string;
}

/** 결제창 실패 응답을 고객 문구와 종류로 바꾼다. 원문 코드·메시지는 돌려주지 않는다. */
export function paymentFailureNotice(failure: PaymentFailureInput): PaymentFailureNotice {
  return isPaymentCanceled(failure)
    ? { kind: 'canceled', message: PAYMENT_CANCELED_MESSAGE }
    : { kind: 'failed', message: PAYMENT_NOT_COMPLETED_MESSAGE };
}

/** 결제 취소가 아닌 실패·거절 안내(주문 생성 거절, 결제 불가, 상품 확인 실패 등)를 같은 모양으로 만든다. */
export function failedPaymentNotice(message: string): PaymentFailureNotice {
  return { kind: 'failed', message };
}

/** 결제창 실패 응답을 고객 문구로 바꾼다. 원문 코드·메시지는 돌려주지 않는다. */
export function paymentFailureMessage(failure: PaymentFailureInput): string {
  return paymentFailureNotice(failure).message;
}
