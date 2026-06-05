'use client';

import type { Order } from '@greenhub/shared';
import { Container, Stack } from '@mantine/core';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { OrderBulkActionBar } from '../../orders/_components/OrderBulkActionBar';
import { OrderCard } from '../../orders/_components/OrderCard';

const ORDER: Order = {
  id: 'e2e-bulk-prepare-order',
  orderNumber: '20260603-000167',
  storeId: 'e2e-store',
  userId: 'e2e-user',
  productId: 'e2e-product',
  quantity: 1,
  saleType: 'normal',
  status: 'ACCEPTED',
  deliveryMethod: 'direct',
  deliveryFee: 0,
  deliveryAddress: {
    address: '서울특별시 중구 세종대로 110',
    addressDetail: '일괄 준비 모바일 배치 검증',
    zipCode: '04524',
  },
  isMetropolitan: true,
  hubId: null,
  pickupCode: null,
  totalAmount: 35000,
  requestedDeliveryDate: '2026-06-04',
  preparedAt: null,
  cancelReason: null,
  groupBuyConsent: null,
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
  productName: '모바일 카드 폭 검증용 긴 상품명',
};

export function OrderBulkPrepareFixture() {
  const [selected, setSelected] = useState(false);
  const [opened, setOpened] = useState(false);

  return (
    <Container size="sm" py="md">
      <Stack gap="md">
        <section aria-label="일괄 준비 모바일 상태">
          <Stack gap="sm">
            <OrderBulkActionBar
              mode="prepare"
              eligibleCount={1}
              selectedCount={selected ? 1 : 0}
              loading={false}
              onSelectAll={() => setSelected(true)}
              onClear={() => setSelected(false)}
              onSubmit={() => setOpened(true)}
            />
            <OrderCard
              order={ORDER}
              selected={selected}
              onSelectedChange={(_orderId, nextSelected) => setSelected(nextSelected)}
            />
          </Stack>
        </section>
      </Stack>

      <ConfirmModal
        opened={opened}
        title="선택한 주문을 준비 중으로 바꿀까요?"
        message="1건의 주문을 한 번에 준비 중으로 변경합니다."
        confirmLabel="준비 시작"
        confirmColor="brand"
        onConfirm={() => setOpened(false)}
        onClose={() => setOpened(false)}
      />
    </Container>
  );
}
