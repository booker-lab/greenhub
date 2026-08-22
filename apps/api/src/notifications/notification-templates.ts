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

export function renderNotificationMessage(
  templateCode: ApiNotificationTemplateCode,
  variables: Record<string, string>,
): string {
  const template = NOTIFICATION_TEMPLATES[templateCode];
  for (const key of template.requiredVariables) {
    const value = variables[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${templateCode} 알림의 필수 본문 변수 ${key}가 누락되었습니다.`);
    }
  }

  return template.body.replace(/#\{([A-Za-z0-9_]+)\}/g, (_, key: string) => variables[key]);
}
