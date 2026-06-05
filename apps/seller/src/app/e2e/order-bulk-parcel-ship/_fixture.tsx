'use client';

import type { Order } from '@greenhub/shared';
import { Container, Stack } from '@mantine/core';
import { useState } from 'react';
import { BulkParcelShipModal } from '../../orders/_components/BulkParcelShipModal';
import { OrderBulkActionBar } from '../../orders/_components/OrderBulkActionBar';
import { OrderCard } from '../../orders/_components/OrderCard';

const ORDER: Order = {
  id: 'e2e-bulk-parcel-order',
  orderNumber: '20260603-000174',
  storeId: 'e2e-store',
  userId: 'e2e-user',
  productId: 'e2e-product',
  quantity: 1,
  saleType: 'normal',
  status: 'PREPARING',
  deliveryMethod: 'parcel',
  deliveryFee: 3500,
  deliveryAddress: {
    address: '서울특별시 중구 세종대로 110',
    addressDetail: '일괄 택배 발송 모바일 배치 검증',
    zipCode: '04524',
  },
  isMetropolitan: true,
  hubId: null,
  pickupCode: null,
  totalAmount: 38500,
  requestedDeliveryDate: '2026-06-04',
  preparedAt: '2026-06-03T01:00:00.000Z',
  cancelReason: null,
  groupBuyConsent: null,
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
  productName: '모바일 송장 모달 폭 검증용 긴 상품명',
};

export function OrderBulkParcelShipFixture() {
  const [selected, setSelected] = useState(false);
  const [opened, setOpened] = useState(false);

  return (
    <Container size="sm" py="md">
      <section aria-label="일괄 택배 발송 모바일 상태">
        <Stack gap="sm">
          <OrderBulkActionBar
            mode="shipParcel"
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
            bulkActionMode="shipParcel"
            onSelectedChange={(_orderId, nextSelected) => setSelected(nextSelected)}
          />
        </Stack>
      </section>

      <BulkParcelShipModal
        opened={opened}
        orders={selected ? [ORDER] : []}
        loading={false}
        onClose={() => setOpened(false)}
        onConfirm={async () => setOpened(false)}
      />
    </Container>
  );
}
