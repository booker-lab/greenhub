import type { SaleRound } from '@greenhub/shared';
import {
  formatOrderCloseLabel,
  formatRoundTime,
  isRoundOrderClosed,
} from '@/lib/round-schedule-label';

export interface RoundScheduleStep {
  label: string;
  value: string;
}

/**
 * 상품 상세 "주문부터 배송까지" 목록의 주문 마감 줄. 홈(formatOrderCloseStatus)과 같은 판정으로
 * 마감이 지난 회차에는 "~까지"를 붙이지 않고 "주문 마감됨"과 시각만 보인다.
 * 예: { label: '주문 마감', value: '11월 8일(일) 밤 12시까지' },
 * 마감 뒤 { label: '주문 마감됨', value: '11월 8일(일) 밤 12시' }.
 */
export function roundOrderCloseStep(
  round: Pick<SaleRound, 'status' | 'schedule'>,
  nowMillis: number,
): RoundScheduleStep {
  const closeAt = round.schedule.orderCloseAt;
  if (!isRoundOrderClosed(round, nowMillis)) {
    return { label: '주문 마감', value: formatOrderCloseLabel(closeAt) };
  }
  return { label: '주문 마감됨', value: formatRoundTime(closeAt) ?? '일정 확인 중' };
}
