'use client';

import type { OrderStatus, PostDeliveryRefundReasonCode } from '@greenhub/shared';
import { useRef, useState } from 'react';
import { notify } from '@/components/AppToaster';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import {
  type AdminOrder,
  describeAdminCommandOutcome,
  describeRefundRecovery,
  useAdminOrders,
  useAdminStores,
} from '@/hooks/useAdmin';
import { AdminAttentionLine, AdminPageHeader, ProblemCount } from '../_components/adminList';
import { useAdminTodoCountsValue } from '../_components/adminTodoContext';
import { LoadMoreFooter } from '../_components/LoadMoreFooter';
import { OrdersFilters } from './_components/OrdersFilters';
import { OrdersTable } from './_components/OrdersTable';
import { PostDeliveryRefundModal } from './_components/PostDeliveryRefundModal';
import { RefundConfirmModal } from './_components/RefundConfirmModal';
import {
  buildStoreOptions,
  describeOrderAttention,
  describeRefundTarget,
  normalizeRefundReason,
  ORDER_STATUS_TABS,
} from './_lib';

export default function AdminOrdersClient() {
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  // 가게는 판매자 목록에서 이름으로 고른다(겹친 응답은 훅이 최신만 반영).
  const { stores } = useAdminStores();
  const {
    orders,
    hasMore,
    loading,
    loadingMore,
    error,
    moreError,
    reload,
    loadMore,
    forceRefund,
    postDeliveryRefund,
  } = useAdminOrders({
    storeId: storeFilter || undefined,
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

  // 같은 주문의 환불 요청은 한 번에 하나만 보내고, 결과(회수 필요 포함)를 알림으로 보여 준다.
  const runLocked = async (
    target: AdminOrder | null,
    command: (order: AdminOrder) => ReturnType<typeof forceRefund>,
  ) => {
    if (!target || inFlightRef.current.has(target.id)) return;
    inFlightRef.current.add(target.id);
    setProcessingIds(new Set(inFlightRef.current));
    try {
      const outcome = await command(target);
      if (outcome.recovery) {
        // 이미 지급한 정산의 주문 — 판매자에게 돌려받을 금액은 닫을 때까지 남긴다.
        notify({
          color: 'red',
          autoClose: false,
          title: '환불 완료 · 판매자 회수 필요',
          message: `주문 ${describeRefundTarget(target).orderLabel} — ${describeRefundRecovery(outcome.recovery)}`,
        });
      }
      if (outcome.kind === 'confirmed' && outcome.reconciled) return;
      // stale은 완료+재조회 copy를 사용한다. rejected는 서버 reason 보존, unknown은 재확인 우선.
      const presentation = describeAdminCommandOutcome(outcome, '환불');
      notify({
        color: outcome.kind === 'rejected' ? 'red' : 'yellow',
        title: presentation.title,
        message: `주문 ${describeRefundTarget(target).orderLabel} — ${presentation.message}`,
      });
    } finally {
      inFlightRef.current.delete(target.id);
      setProcessingIds(new Set(inFlightRef.current));
    }
  };

  const storeOptions = buildStoreOptions(stores);
  const storeName = storeOptions.find((option) => option.value === storeFilter)?.label;
  const todo = useAdminTodoCountsValue();
  const attention = describeOrderAttention(todo.orders, !loading && error === null ? orders : []);
  const loadedLabel = `불러온 ${orders.length}건${hasMore ? ' · 더 있음' : ''}`;

  return (
    <div>
      {/* ② 방향(design-direction.md §5 어드민 "주문", §8 D7): 명사 하나의 h1과 지금 기준 한 줄. */}
      <AdminPageHeader
        title="주문"
        subline={
          <>
            {storeFilter ? storeName : '전체 가게'}
            {!loading && error === null && <> · {loadedLabel}</>}
          </>
        }
      />

      {attention && (
        <AdminAttentionLine>
          확인할 주문{' '}
          <ProblemCount>
            {attention.total}
            {attention.heldMore ? '+' : ''}
          </ProblemCount>
          건
          {attention.held !== null && (
            <>
              {' '}
              · 배송 보류 {attention.held}
              {attention.heldMore ? '+' : ''}
            </>
          )}
          {attention.refundFailed > 0 && (
            <>
              {' '}
              · 환불 실패 {attention.refundFailed}
              <span className="text-[var(--color-text-secondary)]">
                {' '}
                (불러온 {orders.length}건 기준)
              </span>
            </>
          )}
          {attention.held !== null && attention.held > 0 && statusFilter !== 'DELIVERY_HELD' && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => setStatusFilter('DELIVERY_HELD')}
                className="cursor-pointer border-0 bg-transparent p-0 text-[15px] font-bold text-foreground underline underline-offset-4"
              >
                배송 보류만 보기
              </button>
            </>
          )}
        </AdminAttentionLine>
      )}

      <OrdersFilters
        storeFilter={storeFilter}
        storeOptions={storeOptions}
        onStoreChange={setStoreFilter}
      />

      <div className="mb-2">
        <SegmentedTabs<'' | OrderStatus>
          tabs={ORDER_STATUS_TABS}
          value={statusFilter}
          onChange={setStatusFilter}
          layout="scroll"
          variant="underline"
          surface="paper"
          ariaLabel="주문 상태"
        />
      </div>

      <OrdersTable
        orders={orders}
        loading={loading}
        error={error}
        processingIds={processingIds}
        onRefund={openRefund}
        onPostDeliveryRefund={openDeliveredRefund}
        onRetry={reload}
      />

      {error === null && !loading && orders.length > 0 && (
        <p className="m-0 mt-3 text-[13px] leading-[18px] text-[var(--color-text-secondary)] [word-break:keep-all]">
          배송 완료 주문은 행 끝 ⋮의 "배송 후 환불…"로 환불합니다.
        </p>
      )}

      {error === null && !loading && (
        <LoadMoreFooter
          hasMore={hasMore}
          loadingMore={loadingMore}
          moreError={moreError}
          onLoadMore={loadMore}
        />
      )}

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
    </div>
  );
}
