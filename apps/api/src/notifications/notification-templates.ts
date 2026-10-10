import type { NotificationTemplateCode } from '@greenhub/shared';

export type ApiNotificationTemplateCode =
  | NotificationTemplateCode
  | 'SELLER_GROUP_CONFIRMED'
  | 'SELLER_GROUP_CANCELLED_LACK'
  | 'SELLER_ORDER_BATCH';

type NotificationTemplate = {
  body: string;
  requiredVariables: readonly string[];
};

export const NOTIFICATION_TEMPLATES: Record<ApiNotificationTemplateCode, NotificationTemplate> = {
  ORDER_ACCEPTED: {
    body: '#{name}님, 주문 #{orderId}이 접수되었습니다.',
    requiredVariables: ['name', 'orderId'],
  },
  ORDER_PREPARING: {
    body: '주문 #{orderId}의 상품 준비가 시작되었습니다.',
    requiredVariables: ['orderId'],
  },
  ORDER_DELIVERING: {
    body: '주문 #{orderId}의 배송이 시작되었습니다.',
    requiredVariables: ['orderId'],
  },
  ORDER_DELIVERY_HELD: {
    body: '주문 #{orderId}의 배송이 보류되었습니다.\n사유: #{reason}',
    requiredVariables: ['orderId', 'reason'],
  },
  ORDER_REDELIVERY_PAYMENT_REQUESTED: {
    body: '주문 #{orderId}의 재배송비 결제가 필요합니다.',
    requiredVariables: ['orderId'],
  },
  ORDER_REDELIVERY_SCHEDULED: {
    body: '주문 #{orderId}의 재배송이 예정되었습니다.',
    requiredVariables: ['orderId'],
  },
  ORDER_HUB_ARRIVED: {
    body: '#{productName}이(가) 거점에 도착했습니다.\n픽업 코드: #{pickupCode}\n수령 장소: #{hubAddress}',
    requiredVariables: ['productName', 'pickupCode', 'hubAddress'],
  },
  ORDER_DELIVERED: {
    body: '주문 #{orderId}의 배송이 완료되었습니다.',
    requiredVariables: ['orderId'],
  },
  ORDER_CANCELLED: {
    body: '주문 #{orderId}이 취소되었습니다.\n사유: #{reason}',
    requiredVariables: ['orderId', 'reason'],
  },
  ROUND_ORDER_CONFIRMED: {
    body: '회차 주문 #{orderId}이 확정되었습니다.',
    requiredVariables: ['orderId'],
  },
  OPERATION_ISSUE_CREATED: {
    body: '확인이 필요한 운영 항목이 생성되었습니다.',
    requiredVariables: [],
  },
  CUSTOMER_NOTICE_FAILED: {
    body: '고객 안내가 최종 실패하여 운영 확인이 필요합니다.',
    requiredVariables: [],
  },
  GROUP_JOINED: {
    body: '#{name}님, #{productName} 공동구매에 참여하셨습니다.\n현재 #{currentParticipants}/#{minParticipants}명 참여 중입니다.',
    requiredVariables: ['name', 'productName', 'currentParticipants', 'minParticipants'],
  },
  GROUP_DEADLINE_SOON: {
    body: '#{productName} 공동구매 마감이 임박했습니다.\n#{remaining}명만 더 모이면 확정됩니다.',
    requiredVariables: ['productName', 'remaining'],
  },
  GROUP_CONFIRMED: {
    body: '#{productName} 공동구매가 확정되었습니다.\n배송 예정일: #{groupDeliveryDate}',
    requiredVariables: ['productName', 'groupDeliveryDate'],
  },
  GROUP_CANCELLED_LACK: {
    body: '[목표 수량 미달성으로 취소] #{productName} 공동구매 주문이 취소되었습니다.',
    requiredVariables: ['productName'],
  },
  GROUP_CANCELLED_SELF: {
    body: '공동구매 주문 #{orderId}의 취소와 환불이 접수되었습니다.',
    requiredVariables: ['orderId'],
  },
  GROUP_PREPARING: {
    body: '#{productName} 공동구매 상품 준비가 시작되었습니다.',
    requiredVariables: ['productName'],
  },
  GROUP_DELIVERING: {
    body: '#{productName} 공동구매 상품 배송이 시작되었습니다.',
    requiredVariables: ['productName'],
  },
  GROUP_DELIVERED: {
    body: '#{productName} 공동구매 상품 배송이 완료되었습니다.',
    requiredVariables: ['productName'],
  },
  SELLER_GROUP_CONFIRMED: {
    body: '#{productName} 공동구매 목표가 달성되었습니다.',
    requiredVariables: ['productName'],
  },
  SELLER_GROUP_CANCELLED_LACK: {
    body: '#{productName} 공동구매가 목표 미달로 취소되었습니다.',
    requiredVariables: ['productName'],
  },
  SELLER_ORDER_BATCH: {
    body: '오늘 주문은 #{orderCount}건, 총 #{totalAmount}원입니다.',
    requiredVariables: ['orderCount', 'totalAmount'],
  },
};

/**
 * 본문 변수 1개의 최대 글자 수(코드 포인트 기준). 알림톡·SMS 본문은 등록 템플릿의 고정 문구가
 * 대부분을 차지하고 변수는 한 줄 값만 들어가야 하므로, 변수별 상한을 두고 넘으면 자른다.
 * 목록에 없는 변수는 NOTIFICATION_VARIABLE_DEFAULT_MAX_LENGTH를 쓴다.
 */
export const NOTIFICATION_VARIABLE_MAX_LENGTH: Readonly<Record<string, number>> = {
  name: 20,
  orderId: 64,
  reason: 100,
  productName: 60,
  pickupCode: 20,
  hubAddress: 120,
  groupDeliveryDate: 40,
  currentParticipants: 20,
  minParticipants: 20,
  remaining: 20,
  orderCount: 20,
  totalAmount: 20,
};

export const NOTIFICATION_VARIABLE_DEFAULT_MAX_LENGTH = 100;

// 이름 변수가 링크·도메인처럼 보이면 본문에 그대로 넣지 않고 이 값으로 바꾼다.
export const NOTIFICATION_NAME_FALLBACK = '고객';

// 제어문자(줄바꿈·탭 포함)와 줄/문단 구분자는 공백으로 바꾼다.
const NOTIFICATION_LINE_BREAK_OR_CONTROL = /[\p{Cc}\u2028\u2029]/gu;
// 보이지 않는 서식 문자(soft hyphen, zero-width space/non-joiner, 양방향 제어, BOM 등)는
// 제거한다. 이모지 조합에 쓰이는 zero-width joiner(U+200D)는 남긴다.
export const INVISIBLE_FORMAT_CHARACTERS =
  /[\u00AD\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// scheme URL, www., 또는 도메인(`<문자>.<영문>/…` 경로가 붙거나 흔한 최상위 도메인으로 끝남).
// `john.doe`·`Mr.Kim`처럼 점이 들어간 이름은 링크로 보지 않는다.
const NOTIFICATION_LINK_LIKE =
  /[a-z][a-z0-9+.-]*:\/\/|www\.|[\p{L}\p{N}-]+\.(?:[a-z]{2,}\/|(?:com|net|org|kr|co|io|me|ly|gl|to|cc|tv|us|jp|cn|app|xyz|info|biz|shop|site|top|link|online|store)(?![a-z]))/iu;

/**
 * 알림 본문 변수 1개를 한 줄 텍스트로 정리한다. 제어문자·줄바꿈은 공백으로, 보이지 않는 서식
 * 문자는 제거하고, 연속 공백을 하나로 줄인 뒤 변수별 상한으로 자른다. 한글 등 일반 문자는 그대로 둔다.
 */
export function sanitizeNotificationVariable(key: string, value: unknown): string {
  const maxLength =
    NOTIFICATION_VARIABLE_MAX_LENGTH[key] ?? NOTIFICATION_VARIABLE_DEFAULT_MAX_LENGTH;
  const singleLine = toSingleLineText(value, Number.POSITIVE_INFINITY);
  if (key === 'name' && NOTIFICATION_LINK_LIKE.test(singleLine)) {
    return NOTIFICATION_NAME_FALLBACK;
  }
  return toSingleLineText(singleLine, maxLength);
}

/**
 * 문자열을 한 줄 텍스트로 정리하고 maxLength(코드 포인트)를 넘으면 말줄임표로 자른다.
 * 문자열이 아니면 빈 문자열을 돌려준다.
 */
export function toSingleLineText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const singleLine = value
    .replace(INVISIBLE_FORMAT_CHARACTERS, '')
    .replace(NOTIFICATION_LINE_BREAK_OR_CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(singleLine);
  if (characters.length <= maxLength) return singleLine;
  return `${characters
    .slice(0, Math.max(0, maxLength - 1))
    .join('')
    .trimEnd()}…`;
}

export function renderNotificationMessage(
  templateCode: ApiNotificationTemplateCode,
  variables: Record<string, string>,
): string {
  const template = NOTIFICATION_TEMPLATES[templateCode];
  const sanitized: Record<string, string> = {};
  for (const key of template.requiredVariables) {
    const value = sanitizeNotificationVariable(key, variables[key]);
    if (value.length === 0) {
      throw new Error(`${templateCode} 알림의 필수 본문 변수 ${key}가 누락되었습니다.`);
    }
    sanitized[key] = value;
  }

  return template.body.replace(
    /#\{([A-Za-z0-9_]+)\}/g,
    (_, key: string) => sanitized[key] ?? sanitizeNotificationVariable(key, variables[key]),
  );
}
