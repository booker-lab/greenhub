'use client';

import type { Order } from '@greenhub/shared';
import { Container, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import {
  bulkActionNotification,
  summarizeBulkActionResults,
} from '../../orders/_bulkActionResults';
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

const FAILING_ORDER: Order = {
  ...ORDER,
  id: 'e2e-bulk-parcel-failing-order',
  orderNumber: '20260603-000173',
  productName: '부분 실패 결과 검증용 주문',
};

export function OrderBulkParcelShipFixture() {
  const [orders, setOrders] = useState<Order[]>([ORDER, FAILING_ORDER]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState(false);
  const selectedOrders = orders.filter((order) => selectedIds.has(order.id));
  const eligibleCount = orders.filter(
    (order) => order.status === 'PREPARING' && order.deliveryMethod === 'parcel',
  ).length;

  return (
    <Container size="sm" py="md">
      <section aria-label="일괄 택배 발송 모바일 상태">
        <Stack gap="sm">
          <OrderBulkActionBar
            mode="shipParcel"
            eligibleCount={eligibleCount}
            selectedCount={selectedOrders.length}
            loading={false}
            onSelectAll={() => setSelectedIds(new Set(orders.map((order) => order.id)))}
            onClear={() => setSelectedIds(new Set())}
            onSubmit={() => setOpened(true)}
          />
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              selected={selectedIds.has(order.id)}
              bulkActionMode="shipParcel"
              onSelectedChange={(orderId, nextSelected) => {
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (nextSelected) next.add(orderId);
                  else next.delete(orderId);
                  return next;
                });
              }}
            />
          ))}
        </Stack>
      </section>

      <BulkParcelShipModal
        opened={opened}
        orders={selectedOrders}
        loading={false}
        onClose={() => setOpened(false)}
        onConfirm={async () => {
          const results = selectedOrders.map((order) =>
            order.id === FAILING_ORDER.id
              ? Promise.reject(new Error('fixture partial failure'))
              : Promise.resolve(order.id),
          );
          const settled = await Promise.allSettled(results);
          const summary = summarizeBulkActionResults(selectedOrders, settled);

          setOrders((current) =>
            current.map((order) =>
              summary.completedIds.has(order.id)
                ? { ...order, status: 'DELIVERED', updatedAt: '2026-06-03T01:30:00.000Z' }
                : order,
            ),
          );
          setSelectedIds(
            (current) => new Set([...current].filter((id) => !summary.completedIds.has(id))),
          );
          setOpened(false);
          notifications.show(bulkActionNotification('parcelShip', summary));
        }}
      />
    </Container>
  );
}
