import type { Order } from '@greenhub/shared';
import { Container } from '@mantine/core';
import { OrderInfoSection } from '../../orders/[id]/_components/OrderInfoSection';

const ORDER: Order = {
  id: 'e2e-group-shortfall-order',
  orderNumber: '20260603-000126',
  storeId: 'e2e-store',
  userId: 'e2e-user',
  productId: 'e2e-product',
  quantity: 1,
  saleType: 'group',
  status: 'CANCELLED',
  deliveryMethod: 'direct',
  deliveryFee: 0,
  deliveryAddress: {
    address: '서울특별시 중구 세종대로 110',
    addressDetail: '공동구매 취소 상태 검증',
    zipCode: '04524',
  },
  isMetropolitan: true,
  hubId: null,
  pickupCode: null,
  totalAmount: 35000,
  requestedDeliveryDate: null,
  preparedAt: null,
  cancelReason: '목표 수량 미달성으로 취소',
  groupBuyConsent: {
    agreed: true,
    agreedAt: '2026-06-03T00:00:00.000Z',
    userId: 'e2e-user',
  },
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
};

export function OrderCancelStatusFixture() {
  return (
    <Container size="sm" py="md">
      <section aria-label="판매자 공동구매 취소 상태">
        <OrderInfoSection order={ORDER} productName="공동구매 취소 검증 상품" groupConfig={null} />
      </section>
    </Container>
  );
}
