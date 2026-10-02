import type { SaleRoundSchedule, SaleRoundStatus } from '@greenhub/shared';

// 홈 마감 띠와 상품 카드 태그에 쓰는 회차 시간 계산. 모두 한국시간 기준이다.
// 띠 문구에는 "주문 마감"을 쓰지 않는다(홈의 주문 마감 안내 문구와 겹치지 않게).

export interface CountdownTarget {
  label: string;
  at: string;
}

/** 주문 받는 중이면 마감까지, 판매 예정이면 주문 시작까지 센다. 그 밖의 상태는 띠를 숨긴다. */
export function countdownTarget(
  status: SaleRoundStatus,
  schedule: Pick<SaleRoundSchedule, 'orderOpenAt' | 'orderCloseAt'>,
): CountdownTarget | null {
  if (status === 'OPEN') return { label: '이번 회차 마감까지', at: schedule.orderCloseAt };
  if (status === 'SCHEDULED') return { label: '주문 시작까지', at: schedule.orderOpenAt };
  return null;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** 예: "2일 14:32:07", "03:05:09". 이미 지났으면 "00:00:00". */
export function formatCountdown(remainingMs: number): string {
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.floor(remainingMs / 1000)) : 0;
  const days = Math.floor(total / 86_400);
  const clock = `${pad(Math.floor((total % 86_400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days}일 ${clock}` : clock;
}

const KST_WEEKDAY = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' });

/** 배송 시작 시각의 한국 요일로 "화 아침 도착" 태그를 만든다. 잘못된 값이면 null. */
export function deliveryDayTag(deliveryStartAt: string): string | null {
  const date = new Date(deliveryStartAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${KST_WEEKDAY.format(date)} 아침 도착`;
}
