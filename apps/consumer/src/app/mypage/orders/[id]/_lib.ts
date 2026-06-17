import { ORDER_STATUS_LABEL, type Order, type OrderStatus } from '@greenhub/shared';
import { getDeliveryMethodLabel } from '../../_lib';

export type ReceiptAction =
  | {
      type: 'pickup';
      title: string;
      code: string;
      address: string;
      description: string;
    }
  | {
      type: 'parcel';
      title: string;
      courierCompany: string | null;
      trackingNumber: string | null;
      description: string;
    }
  | {
      type: 'waiting';
      title: string;
      description: string;
    }
  | {
      type: 'none';
    };

export interface OrderStatusNotice {
  color: 'blue' | 'green' | 'red' | 'yellow' | 'gray';
  title: string;
  description: string;
}

export function getTimelineSteps(order: Order): OrderStatus[] {
  if (order.saleType === 'group') {
    return ['RECRUITING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
  }
  if (order.deliveryMethod === 'hub') {
    return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP'];
  }
  return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
}

export function getCurrentStepIndex(steps: OrderStatus[], status: OrderStatus): number {
  if (status === 'REVIEWED') return steps.length;
  return steps.indexOf(status);
}

export function canConfirmPurchase(order: Pick<Order, 'status'>): boolean {
  return order.status === 'DELIVERED' || order.status === 'PICKED_UP';
}

export function getOrderDeliveryLabel(order: Pick<Order, 'deliveryMethod' | 'saleType'>): string {
  const saleTypeSuffix = order.saleType === 'group' ? ' (공동구매)' : '';
  return `${getDeliveryMethodLabel(order)}${saleTypeSuffix}`;
}

export function getReceiptAction(order: Order): ReceiptAction {
  if (order.status === 'CANCELLED') return { type: 'none' };

  const pickupVisibleStatuses: OrderStatus[] = ['HUB_ARRIVED', 'PICKED_UP', 'REVIEWED'];
  if (
    order.deliveryMethod === 'hub' &&
    order.pickupCode &&
    pickupVisibleStatuses.includes(order.status)
  ) {
    return {
      type: 'pickup',
      title: '픽업 코드',
      code: order.pickupCode,
      address: order.hubAddress ?? order.deliveryAddress?.address ?? '',
      description: '거점에서 코드를 제시하고 상품을 수령하세요.',
    };
  }

  if (order.deliveryMethod === 'parcel') {
    const courierCompany = order.courierCompany?.trim() || null;
    const trackingNumber = order.trackingNumber?.trim() || null;
    if (courierCompany || trackingNumber) {
      return {
        type: 'parcel',
        title: '택배 배송 정보',
        courierCompany,
        trackingNumber,
        description: '판매자가 등록한 택배 정보를 확인하세요.',
      };
    }
    if (['ACCEPTED', 'CONFIRMED', 'PREPARING', 'DELIVERING'].includes(order.status)) {
      return {
        type: 'waiting',
        title: '배송 준비 중',
        description: '판매자가 상품을 준비 중입니다. 운송장 정보가 등록되면 이곳에 표시됩니다.',
      };
    }
  }

  if (
    order.deliveryMethod === 'hub' &&
    ['ACCEPTED', 'PREPARING', 'DELIVERING'].includes(order.status)
  ) {
    return {
      type: 'waiting',
      title: '픽업 준비 중',
      description: '상품이 거점에 도착하면 픽업 코드가 표시됩니다.',
    };
  }

  return { type: 'none' };
}

export function getOrderStatusNotice(order: Order): OrderStatusNotice {
  if (order.status === 'CANCELLED') {
    return {
      color: 'red',
      title: '주문이 취소되었습니다',
      description: order.cancelReason ? `사유: ${order.cancelReason}` : '취소된 주문입니다.',
    };
  }
  if (order.status === 'RECRUITING') {
    return {
      color: 'blue',
      title: '공동구매 모집 중',
      description:
        '모집 마감일까지 참여 인원이 충족되면 주문이 확정됩니다. 인원 미달 시 자동 취소 후 환불됩니다.',
    };
  }
  if (order.status === 'HUB_ARRIVED') {
    return {
      color: 'yellow',
      title: '수령이 필요합니다',
      description: '거점에 상품이 도착했습니다. 픽업 코드를 확인하고 상품을 수령하세요.',
    };
  }
  if (canConfirmPurchase(order)) {
    return {
      color: 'green',
      title: '구매 확정이 가능합니다',
      description: '상품을 받았다면 구매 확정을 눌러 주문을 마무리하세요.',
    };
  }
  if (order.status === 'REVIEWED') {
    return {
      color: 'gray',
      title: '구매 확정 완료',
      description: '구매 확정이 완료된 주문입니다.',
    };
  }
  return {
    color: 'blue',
    title: ORDER_STATUS_LABEL[order.status] ?? '주문 진행 중',
    description: '주문이 진행 중입니다. 상태가 바뀌면 이 화면에 다음 행동이 표시됩니다.',
  };
}
