// 주문 상세의 배송 예정일 표시. 주문 완료 안내(OrderSuccessGuide)와 같은 '11월 10일(화)' 형식으로 보인다.
// 저장값은 보통 'YYYY-MM-DD'(달력 날짜 그대로)이고, 시각이 붙은 ISO 값은 한국 시간(Asia/Seoul) 날짜로 읽는다.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const KST_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function formatCalendarDay(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${month}월 ${day}일(${WEEKDAYS[date.getUTCDay()]})`;
}

/** 배송 예정일 → '11월 10일(화)'. 읽을 수 없는 값이면 null. */
export function formatOrderDeliveryDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return formatCalendarDay(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  }

  // 시각이 있는 ISO 값만 받는다(브라우저마다 해석이 다른 자유 형식 날짜는 받지 않는다).
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const millis = Date.parse(text);
  if (Number.isNaN(millis)) return null;
  const parts = KST_DATE_PARTS.formatToParts(new Date(millis));
  const read = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((part) => part.type === type)?.value);
  return formatCalendarDay(read('year'), read('month'), read('day'));
}

/** 배송 예정일을 읽지 못할 때 주문 완료 화면에 쓰는 고정 문구. */
export const ORDER_DELIVERY_NOTICE_FALLBACK =
  '화요일 오전 9시까지 문 앞에 배송해요. 경기도 이천시 직접배송 주문이에요.';

/**
 * 주문 완료 화면의 배송 안내 본문. 날짜는 주문의 배송 예정일에서 읽는다.
 * 예: "11월 10일(화) 오전 9시까지 문 앞에 배송해요. 경기도 이천시 직접배송 주문이에요."
 * 읽을 수 없으면 고정 문구.
 */
export function formatOrderDeliveryNotice(requestedDeliveryDate: unknown): string {
  const day = formatOrderDeliveryDate(requestedDeliveryDate);
  return day
    ? `${day} 오전 9시까지 문 앞에 배송해요. 경기도 이천시 직접배송 주문이에요.`
    : ORDER_DELIVERY_NOTICE_FALLBACK;
}
