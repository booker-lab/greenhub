import type { SaleRound } from '@greenhub/shared';
import { isRoundOrderClosed } from '@/lib/round-schedule-label';

// 체크아웃에 머무는 동안 회차 주문이 마감됐는지 판정한다(UX 감사 C-13).
// 근거는 두 가지다: 결제를 누를 때 받은 주문 생성 거절 응답, 이미 가진 회차 일정·상태.

/** 회차 주문이 마감됐을 때 결제 버튼 위에 보이는 안내. */
export const ROUND_ORDER_CLOSED_MESSAGE = '이번 회차 주문이 마감됐어요.';

/**
 * 주문 생성 API가 회차 주문 창이 닫혀 거절할 때 쓰는 문구
 * (apps/api/src/sale-rounds/sale-round-state.contract.ts의 assertOrderWindowOpen).
 * API는 이 거절을 409 Conflict와 문구로만 구분한다(별도 코드값이 없다). 그래서 문구 비교는 여기 한 곳에만 둔다.
 * - '현재 주문 가능한 회차가 아닙니다.': 자동 상태 계산 뒤 OPEN이 아니다(마감 시각 지남·수량 마감·종료·취소).
 * - '주문 마감된 회차입니다.': OPEN인데 주문 마감 시각이 지났다.
 */
const ROUND_ORDER_WINDOW_CLOSED_MESSAGES: ReadonlySet<string> = new Set([
  '현재 주문 가능한 회차가 아닙니다.',
  '주문 마감된 회차입니다.',
]);

/** setTimeout이 받을 수 있는 가장 긴 지연(약 24.8일). 이보다 먼 마감은 타이머를 걸지 않는다. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 주문 생성 응답(상태 코드·본문)이 회차 주문 마감 거절인지. */
export function isRoundOrderClosedRejection(status: number, body: unknown): boolean {
  if (status !== 409 || !isRecord(body) || typeof body.message !== 'string') return false;
  return ROUND_ORDER_WINDOW_CLOSED_MESSAGES.has(body.message.trim());
}

/**
 * 주문 마감 시각까지 남은 시간(ms). 화면을 그 시각에 다시 그려 지나간 마감을 알아보는 데 쓴다.
 * 시각이 잘못됐거나 이미 지났거나 타이머로 걸 수 없을 만큼 멀면 null.
 */
export function msUntilRoundOrderClose(orderCloseAt: string, nowMillis: number): number | null {
  const closeAt = Date.parse(orderCloseAt);
  if (!Number.isFinite(closeAt) || !Number.isFinite(nowMillis)) return null;
  const delay = closeAt - nowMillis;
  if (delay <= 0 || delay > MAX_TIMER_DELAY_MS) return null;
  return delay;
}

export interface CheckoutRoundClosedInput {
  /** 장바구니와 맞춰 본 회차. 아직 모르면 null. */
  round: Pick<SaleRound, 'status' | 'schedule'> | null;
  nowMillis: number;
  /** 결제를 누를 때 주문 생성 API가 회차 마감으로 거절했는지. */
  closedByOrderResponse: boolean;
  /** 주문 생성·결제창 진행 중이면 결과를 기다린다(이미 만든 주문의 결제가 끝날 수 있다). */
  paymentInFlight: boolean;
}

/** 체크아웃에 회차 마감 안내를 보이고 결제 버튼을 끌지. */
export function isCheckoutRoundClosed(input: CheckoutRoundClosedInput): boolean {
  if (input.paymentInFlight) return false;
  if (input.closedByOrderResponse) return true;
  return input.round !== null && isRoundOrderClosed(input.round, input.nowMillis);
}
