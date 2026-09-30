import type { SaleRoundStatus } from '@greenhub/shared';

// 회차 일정 문구. 모두 한국시간 기준이며, 자정(00:00)은 전날 "밤 12시"로 읽히게 표기한다.
const KST_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 24 * 60 * 60 * 1000;

function kstParts(date: Date) {
  const parts = Object.fromEntries(
    KST_PARTS.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
  };
}

/** 예: "11월 1일(일) 오전 10시", "11월 8일(일) 밤 12시". 잘못된 값이면 null. */
export function formatRoundTime(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const at = kstParts(date);
  if (at.hour === 0 && at.minute === 0) {
    const previous = kstParts(new Date(date.getTime() - DAY_MS));
    return `${previous.month}월 ${previous.day}일(${previous.weekday}) 밤 12시`;
  }
  const period = at.hour < 12 ? '오전' : '오후';
  const hour12 = at.hour % 12 === 0 ? 12 : at.hour % 12;
  const minute = at.minute > 0 ? ` ${at.minute}분` : '';
  return `${at.month}월 ${at.day}일(${at.weekday}) ${period} ${hour12}시${minute}`;
}

/** 예: "11월 8일(일) 밤 12시까지" */
export function formatOrderCloseLabel(value: string): string {
  const time = formatRoundTime(value);
  return time ? `${time}까지` : '일정 확인 중';
}

/** 예: "11월 1일(일) 오전 10시 주문 시작" */
export function formatOrderOpenLabel(value: string): string {
  const time = formatRoundTime(value);
  return time ? `${time} 주문 시작` : '주문 시작 일정 확인 중';
}

/** 주문 시작 전 회차는 "이번 주"가 아니므로 제목을 나눈다. */
export function roundSectionTitle(status: SaleRoundStatus): string {
  return status === 'SCHEDULED' ? '판매 예정' : '이번 주 판매';
}
