import { CONNECTION_UNSTABLE_MESSAGE, isConnectionFailure } from '@/lib/load-error-message';

// 체크아웃 화면에 보이는 결제 오류 문구. 결제 설정·브라우저 원문 대신 고객이 할 일을 해요체로 알린다.

/** 결제 설정(결제사 공개 키 등)을 읽지 못해 결제를 시작할 수 없을 때. */
export const CHECKOUT_PAYMENT_UNAVAILABLE_MESSAGE =
  '지금은 결제를 시작할 수 없어요. 잠시 후 다시 시도해 주세요.';

/** 주문 생성이 거절됐는데 API가 안내 문구를 주지 않았을 때. */
export const ORDER_CREATE_FAILED_MESSAGE = '주문을 만들지 못했어요. 잠시 후 다시 시도해 주세요.';

/** 원인을 알 수 없는 결제 진행 실패. */
export const CHECKOUT_PAYMENT_FAILED_MESSAGE =
  '결제를 진행하지 못했어요. 잠시 후 다시 시도해 주세요.';

/**
 * 결제 진행 중 잡힌 오류를 화면 문구로 바꾼다.
 * 연결 실패("Failed to fetch" 같은 브라우저 원문)는 연결 안내로, 문구가 없는 오류는 일반 안내로 바꾸고,
 * 그 밖에는 이미 고객 문구로 만든 오류 메시지를 그대로 쓴다.
 */
export function checkoutPaymentErrorMessage(error: unknown): string {
  if (isConnectionFailure(error)) return CONNECTION_UNSTABLE_MESSAGE;
  if (error instanceof Error && error.message.trim()) return error.message;
  return CHECKOUT_PAYMENT_FAILED_MESSAGE;
}
