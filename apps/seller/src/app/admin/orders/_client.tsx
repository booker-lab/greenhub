'use client';

import type { PostDeliveryRefundReasonCode } from '@greenhub/shared';
import { Box, Group, Text, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useRef, useState } from 'react';
import { type AdminOrder, useAdminOrders } from '@/hooks/useAdmin';
import { describeAdminCommandOutcome } from '@/hooks/useAdmin';
import { OrdersFilters } from './_components/OrdersFilters';
import { OrdersTable } from './_components/OrdersTable';
import { PostDeliveryRefundModal } from './_components/PostDeliveryRefundModal';
import { RefundConfirmModal } from './_components/RefundConfirmModal';
import { describeRefundTarget, normalizeRefundReason } from './_lib';

/** 스토어 ID 입력이 멈춘 뒤 조회하기까지 기다리는 시간. 글자마다 재조회하지 않는다(정산 탭과 같은 값). */
const STORE_FILTER_DEBOUNCE_MS = 300;

export default function AdminOrdersClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // 가게 ID는 글자마다 조회하지 않고 입력이 멈춘 뒤 조회한다(겹친 응답은 훅이 최신만 반영).
  const [debouncedStoreFilter] = useDebouncedValue(storeFilter, STORE_FILTER_DEBOUNCE_MS);
  const { orders, loading, error, reload, forceRefund, postDeliveryRefund } = useAdminOrders({
    storeId: debouncedStoreFilter || undefined,
    status: statusFilter || undefined,
  });
  const [refundTarget, setRefundTarget] = useState<AdminOrder | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [deliveredTarget, setDeliveredTarget] = useState<AdminOrder | null>(null);
  const [deliveredReason, setDeliveredReason] = useState<PostDeliveryRefundReasonCode | null>(null);
  const [deliveredMemo, setDeliveredMemo] = useState('');
  // 여러 건을 이어서 환불해도 각 주문의 처리 중 표시가 따로 유지되도록 id 묶음으로 잠근다.
  // ref는 같은 틱의 두 번 클릭을 막고, state는 버튼 표시를 다시 그린다.
  const inFlightRef = useRef(new Set<string>());
  const [processingIds, setProcessingIds] = useState<ReadonlySet<string>>(() => new Set());

  const openRefund = (order: AdminOrder) => {
    setRefundReason('');
    setRefundTarget(order);
  };

  const openDeliveredRefund = (order: AdminOrder) => {
    setDeliveredReason(null);
    setDeliveredMemo('');
    setDeliveredTarget(order);
  };

  const runRefund = () => {
    const target = refundTarget;
    setRefundTarget(null);
    return runLocked(target, (order) => forceRefund(order.id, normalizeRefundReason(refundReason)));
  };

  const runDeliveredRefund = () => {
    const target = deliveredTarget;
    const reasonCode = deliveredReason;
    setDeliveredTarget(null);
    if (!reasonCode) return;
    return runLocked(target, (order) =>
      postDeliveryRefund(order.id, reasonCode, deliveredMemo.trim()),
    );
  };

  // 같은 주문의 환불 요청은 한 번에 하나만 보내고, 결과를 알림으로 보여 준다.
  const runLocked = async (
    target: AdminOrder | null,
    command: (order: AdminOrder) => ReturnType<typeof forceRefund>,
  ) => {
    if (!target || inFlightRef.current.has(target.id)) return;
    inFlightRef.current.add(target.id);
    setProcessingIds(new Set(inFlightRef.current));
    try {
      const outcome = await command(target);
      if (outcome.kind === 'confirmed' && outcome.reconciled) return;
      // stale은 완료+재조회 copy를 사용한다. rejected는 서버 reason 보존, unknown은 재확인 우선.
      const presentation = describeAdminCommandOutcome(outcome, '환불');
      notifications.show({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: `주문 ${describeRefundTarget(target).orderLabel} — ${presentation.message}`,
      });
    } finally {
      inFlightRef.current.delete(target.id);
      setProcessingIds(new Set(inFlightRef.current));
    }
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          전체 주문{' '}
          <Text
            component="span"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({orders.length})
          </Text>
        </Title>
      </Group>

      <OrdersFilters
        storeFilter={storeFilter}
        statusFilter={statusFilter}
        onStoreChange={setStoreFilter}
        onStatusChange={setStatusFilter}
      />

      <OrdersTable
        orders={orders}
        loading={loading}
        error={error}
        processingIds={processingIds}
        onRefund={openRefund}
        onPostDeliveryRefund={openDeliveredRefund}
        onRetry={reload}
      />

      <RefundConfirmModal
        target={refundTarget}
        reason={refundReason}
        onReasonChange={setRefundReason}
        onConfirm={runRefund}
        onClose={() => setRefundTarget(null)}
      />

      <PostDeliveryRefundModal
        target={deliveredTarget}
        reasonCode={deliveredReason}
        onReasonCodeChange={setDeliveredReason}
        memo={deliveredMemo}
        onMemoChange={setDeliveredMemo}
        onConfirm={runDeliveredRefund}
        onClose={() => setDeliveredTarget(null)}
      />
    </Box>
  );
}
