// 같은 회차에서 결제를 마치지 않은 시도가 쌓여 새 결제가 막혔는지 알아보고 고객 문구를 정한다(UX 감사 C-02).
//
// API는 같은 고객·같은 회차의 만료 전 결제 예약을 3건까지만 두고, 넘으면 409로 거절한다
// (apps/api/src/orders/order-capacity.service.ts의 MAX_ACTIVE_CHECKOUT_HOLDS_PER_USER_ROUND).
// 예약은 만든 뒤 15분이 지나면 만료되고(같은 파일 reserveCheckoutInTransaction의 expiresAt),
// 한도는 만료 시각이 지난 예약을 세지 않는다(countActiveCheckoutHolds). 그래서 가장 오래된 예약이
// 늦어도 15분 안에 빠져, 기다리면 다시 결제할 수 있다.

/** 결제 예약 한도로 막혔을 때 결제 버튼 위에 보이는 안내. */
export const CHECKOUT_HOLD_LIMIT_MESSAGE =
  '결제를 마치지 않은 이전 결제 시도가 있어 지금은 결제할 수 없어요. 이전 결제 시도가 정리되면(최대 15분) 다시 결제할 수 있어요.';

/** 안내 아래에서 고객을 주문 내역으로 보내는 버튼 이름과 경로. 결제 전 주문은 주문 내역에 보인다. */
export const CHECKOUT_HOLD_LIMIT_ORDERS_LABEL = '주문 내역 보기';
export const CHECKOUT_HOLD_LIMIT_ORDERS_PATH = '/mypage';

/**
 * 주문 생성 API가 결제 예약 한도로 거절할 때 쓰는 문구
 * (order-capacity.service.ts의 ACTIVE_CHECKOUT_HOLD_LIMIT_MESSAGE).
 * API는 이 거절을 409 Conflict와 문구로만 구분한다(별도 코드값이 없다). 그래서 문구 비교는 여기 한 곳에만 둔다.
 */
const ACTIVE_CHECKOUT_HOLD_LIMIT_API_MESSAGE =
  '이전 결제 시도를 아직 처리하고 있어요. 잠시 후 다시 시도하거나 주문 내역을 확인해 주세요.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 주문 생성 응답(상태 코드·본문)이 같은 회차 결제 예약 한도 거절인지. */
export function isCheckoutHoldLimitRejection(status: number, body: unknown): boolean {
  if (status !== 409 || !isRecord(body) || typeof body.message !== 'string') return false;
  return body.message.trim() === ACTIVE_CHECKOUT_HOLD_LIMIT_API_MESSAGE;
}
