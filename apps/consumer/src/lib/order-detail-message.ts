/**
 * 주문 상세 화면의 조회 안내 문구.
 *
 * 주문 조회 훅(useOrderStatus)의 오류 글자는 결제 완료 화면과 같이 쓰므로, 주문 상세는 읽기 상태(status)에서
 * 직접 해요체 고객 문구를 고른다. 연결 실패는 앱 공통 연결 안내(load-error-message)를 그대로 쓴다.
 */
import { CONNECTION_UNSTABLE_MESSAGE } from '@/lib/load-error-message';

// 최신 주문 상태를 다시 읽지 못해 취소·구매 확정·재배송비 결제를 막을 때 보이는 문구.
export const ORDER_DETAIL_STALE_MESSAGE =
  '최신 주문 상태를 확인하지 못했어요. 상태를 다시 확인한 뒤 시도해 주세요.';
// 연결은 됐지만 주문 정보를 읽지 못했을 때(응답 오류·형식 오류).
export const ORDER_DETAIL_LOAD_FAILED_MESSAGE =
  '주문 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';

/** 주문 조회 일시 실패(network·server)를 고객 문구로 바꾼다. */
export function orderDetailReadFailureMessage(status: 'network' | 'server'): string {
  return status === 'network' ? CONNECTION_UNSTABLE_MESSAGE : ORDER_DETAIL_LOAD_FAILED_MESSAGE;
}
