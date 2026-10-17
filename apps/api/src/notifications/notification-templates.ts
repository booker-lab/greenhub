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

/**
 * 판매자가 직접 입력한 값이 들어가는 본문 변수와, 그 값에 웹 주소·도메인·전화번호가 있을 때 대신 넣을
 * 고정 문구. 승인된 템플릿 본문은 그대로 두고 변수 값만 바꾼다.
 * - reason: 판매자 취소 사유(ORDER_CANCELLED). 보류 사유·환불 안내 사유는 서버 고정 문구다.
 * - productName: 상품명(거점 도착·공동구매 알림).
 * - hubAddress: 판매자가 등록한 거점 주소(거점 도착 알림).
 */
export const NOTIFICATION_SELLER_TEXT_FALLBACKS: Readonly<Record<string, string>> = {
  reason: '판매자 사정',
  productName: '주문 상품',
  hubAddress: '주문 상세에서 확인해 주세요',
};

// 제어문자(줄바꿈·탭 포함)와 줄/문단 구분자는 공백으로 바꾼다.
const NOTIFICATION_LINE_BREAK_OR_CONTROL = /[\p{Cc}\u2028\u2029]/gu;
// 보이지 않는 서식 문자(soft hyphen, zero-width space/non-joiner, 양방향 제어, BOM 등)는
// 제거한다. 이모지 조합에 쓰이는 zero-width joiner(U+200D)는 남긴다.
export const INVISIBLE_FORMAT_CHARACTERS =
  /[\u00AD\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// 점 뒤에 오면 링크로 보는 흔한 최상위 도메인. 점 뒤에 경로(/)가 붙으면 목록과 무관하게 링크로 본다.
// 한국 성씨 로마자(Do·So·Im·Ga·Kim·Lee 등)와 겹치는 도메인은 이름 오판을 피하려고 넣지 않는다.
const COMMON_TOP_LEVEL_DOMAINS =
  'com|net|org|kr|co|io|me|ly|gl|to|cc|tv|us|jp|cn|app|xyz|info|biz|shop|site|top|link|online|' +
  'store|ai|dev|page|gg|ws|ru|club|vip|live|click|pw|tk|ml|icu|cyou|sbs|cfd|bond|buzz|asia|' +
  'mobi|win|bid|loan|website|tech|cloud';
// 띄어 쓴 점(`naver . com`)·dot으로 쓴 도메인은 영문 앞말과 이 도메인일 때만 링크로 본다
// (한글 문장 끝 마침표 뒤의 영문 단어를 링크로 오판하지 않게).
const SPACED_DOT_TOP_LEVEL_DOMAINS = 'com|net|org|kr|shop|site|store|xyz|link|info|biz|online|club';

// 링크 판정. 판정 전에 보이지 않는 서식 문자를 지우고 NFKC로 전각 문자를 반각으로 바꾼다.
// `john.doe`·`Mr.Kim`처럼 점이 들어간 이름은 링크로 보지 않는다.
const NOTIFICATION_LINK_LIKE = new RegExp(
  [
    // scheme URL(http://, https://, intent:// 등)과 www.
    '[a-z][a-z0-9+.-]*:\\/\\/',
    'www\\s*[.\\u3002]',
    // 도메인: `<문자>.<영문>/…` 경로가 붙거나 흔한 최상위 도메인으로 끝남
    `[\\p{L}\\p{N}-]+[.\\u3002](?:[a-z]{2,}\\/|(?:${COMMON_TOP_LEVEL_DOMAINS})(?![a-z]))`,
    // 한글 국가 도메인(.한국)
    '[\\p{L}\\p{N}-]+[.\\u3002]한국(?!\\p{L})',
    // 띄어 쓴 점·괄호로 감싼 점·dot·닷으로 가린 도메인(naver . com, naver[.]com, naver dot com, naver닷컴)
    `[a-z0-9-]{2,}\\s*[.\\u3002]\\s*(?:${SPACED_DOT_TOP_LEVEL_DOMAINS})(?![a-z])`,
    '[\\p{L}\\p{N}-]+\\s*[\\[({]\\s*(?:[.\\u3002]|dot|점|닷)\\s*[\\])}]\\s*[a-z]{2,}',
    `[a-z0-9-]{2,}\\s+dot\\s+(?:${SPACED_DOT_TOP_LEVEL_DOMAINS}|co)(?![a-z])`,
    '닷\\s*(?:컴|넷|kr|com|net|org)',
    // IPv4 주소
    '(?<![\\d.])\\d{1,3}(?:\\.\\d{1,3}){3}(?!\\d)',
  ].join('|'),
  'iu',
);

// 전화번호 숫자 사이 구분자: 공백·점·하이픈과 여러 대시 문자.
const PHONE_SEPARATOR = '[\\s.\\-\\u2010-\\u2015\\u2212]';
// 국내 전화번호. 휴대폰(01X), 서울(02), 지역 유선(031~064), 정보이용(060), 인터넷전화(070),
// 수신자부담(080), 안심번호(050X)와 대표번호(15XX·16XX·18XX). 괄호 국번과 +82 국가번호도 본다.
// 앞뒤가 숫자로 이어지면(주문번호·송장번호 등) 전화번호로 보지 않는다.
const KOREAN_PHONE_NUMBER = new RegExp(
  [
    `(?<!\\d)(?:\\+\\s*82${PHONE_SEPARATOR}*\\(?0?\\)?${PHONE_SEPARATOR}*|\\(?0)` +
      `(?:1[016789]|2|3[1-3]|4[1-4]|5[1-5]|6[0-4]|70|80|50[2-8])\\)?` +
      `${PHONE_SEPARATOR}*\\d{3,4}${PHONE_SEPARATOR}*\\d{4}(?!\\d)`,
    `(?<!\\d)1[568]\\d{2}${PHONE_SEPARATOR}?\\d{4}(?!\\d)`,
  ].join('|'),
  'u',
);

// 변수 상한 뒤로 더 보는 글자 수(자르는 경계에 걸친 링크·번호를 놓치지 않을 만큼).
const NOTIFICATION_CONTACT_DETECTION_MARGIN = 32;

function normalizeForContactDetection(text: string): string {
  return text.replace(INVISIBLE_FORMAT_CHARACTERS, '').normalize('NFKC');
}

/**
 * 웹 주소·도메인처럼 보이는 부분이 있는지(scheme URL, www., 흔한 도메인, 가린 도메인, IP 주소).
 * 판정 비용이 길이에 비례해 크게 늘 수 있으므로 길이를 제한한 문자열(수백 자 이하)에만 쓴다.
 */
export function containsLinkLike(text: string): boolean {
  return NOTIFICATION_LINK_LIKE.test(normalizeForContactDetection(text));
}

/**
 * 국내 전화번호(휴대폰·유선·인터넷전화·안심번호·대표번호)가 있는지. containsLinkLike와 같이 길이를
 * 제한한 문자열에만 쓴다.
 */
export function containsPhoneNumber(text: string): boolean {
  return KOREAN_PHONE_NUMBER.test(normalizeForContactDetection(text));
}

/**
 * 알림 본문 변수 1개를 한 줄 텍스트로 정리한다. 제어문자·줄바꿈은 공백으로, 보이지 않는 서식
 * 문자는 제거하고, 연속 공백을 하나로 줄인 뒤 변수별 상한으로 자른다. 한글 등 일반 문자는 그대로 둔다.
 * 이름이 링크처럼 보이면 고정 호칭으로, 판매자 입력 변수(NOTIFICATION_SELLER_TEXT_FALLBACKS)에 웹 주소·
 * 도메인·전화번호가 있으면 그 변수의 고정 문구로 바꾼다.
 */
export function sanitizeNotificationVariable(key: string, value: unknown): string {
  const maxLength =
    NOTIFICATION_VARIABLE_MAX_LENGTH[key] ?? NOTIFICATION_VARIABLE_DEFAULT_MAX_LENGTH;
  const singleLine = toSingleLineText(value, Number.POSITIVE_INFINITY);
  const truncated = toSingleLineText(singleLine, maxLength);
  // 링크·번호 판정은 본문에 실리는 값(자른 결과)과, 자르는 경계에 걸친 표현까지 보도록 상한보다 조금
  // 긴 앞부분을 본다. 자른 결과가 새로 링크처럼 보일 수 있고(`abc.community` → `abc.co…`), 아주 긴
  // 입력(길이 제한 없는 거점 주소 등)에서 정규식 판정 비용이 커지지 않게 판정 범위를 제한한다.
  const inspected = [
    truncated,
    singleLine.slice(0, (maxLength + NOTIFICATION_CONTACT_DETECTION_MARGIN) * 2),
  ];
  if (key === 'name' && inspected.some(containsLinkLike)) {
    return NOTIFICATION_NAME_FALLBACK;
  }
  const sellerTextFallback = NOTIFICATION_SELLER_TEXT_FALLBACKS[key];
  if (
    sellerTextFallback !== undefined &&
    inspected.some((text) => containsLinkLike(text) || containsPhoneNumber(text))
  ) {
    return sellerTextFallback;
  }
  return truncated;
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
