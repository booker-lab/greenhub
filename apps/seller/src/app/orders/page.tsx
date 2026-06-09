'use client';

import type { SaleType } from '@greenhub/shared';
import { Box, Container, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useGroupConfigs } from '@/hooks/useGroupConfigs';
import { useOrders } from '@/hooks/useOrders';
import { apiJson } from '@/lib/api';
import { bulkActionNotification, summarizeBulkActionResults } from './_bulkActionResults';
import { BulkParcelShipModal, type BulkParcelShipPayload } from './_components/BulkParcelShipModal';
import { DateSection } from './_components/DateSection';
import { OrderBulkActionBar } from './_components/OrderBulkActionBar';
import { OrderPriorityAlert } from './_components/OrderPriorityAlert';
import { SaleTypeToggle } from './_components/SaleTypeToggle';
import {
  canBulkPrepareOrder,
  canBulkShipParcelOrder,
  DATE_PRESETS,
  type DateRangePreset,
  GROUP_TABS,
  getBulkParcelShipEligibleIds,
  getBulkPrepareEligibleIds,
  getDateRange,
  getGroupConfigProductIds,
  getGroupHeaderMeta,
  getOrderAlertMeta,
  getOrderDate,
  groupOrdersByDate,
  IN_DELIVERY_SUBFILTERS,
  isArchiveTab,
  isOrderOverdue,
  type OrderGroup,
  STATUS_GROUP_MAP,
} from './_constants';

const VALID_TABS = new Set<OrderGroup>([
  'ACTION_REQUIRED',
  'WAITING',
  'IN_DELIVERY',
  'DONE',
  'CANCELLED',
]);

export default function OrdersPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const { orders, loading, error, groupCounts, firebaseReady } = useOrders(storeId);
  const [saleType, setSaleType] = useState<SaleType>('normal');
  const [activeTab, setActiveTab] = useState<OrderGroup>('ACTION_REQUIRED');
  const [subFilter, setSubFilter] = useState<'ALL' | 'DELIVERING' | 'HUB_ARRIVED'>('ALL');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpened, setBulkConfirmOpened] = useState(false);
  const [bulkParcelShipOpened, setBulkParcelShipOpened] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const clearBulkSelection = () => {
    setSelectedOrderIds(new Set());
  };

  const handleSaleTypeChange = (next: SaleType) => {
    clearBulkSelection();
    setSaleType(next);
    setDatePreset('week');
    setCustomFrom('');
    setCustomTo('');
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as OrderGroup | null;
    if (tab && VALID_TABS.has(tab)) setActiveTab(tab);
  }, []);

  const customInvalid =
    datePreset === 'custom' && !!customFrom && !!customTo && customFrom > customTo;
  // 공구 토글은 날짜 필터 칩 미노출 → 범위 계산 자체를 일반에서만 수행
  const dateRange =
    saleType === 'normal' ? getDateRange(datePreset, activeTab, customFrom, customTo) : null;

  // 공구 우선 알림은 현재 탭 밖의 지연 주문도 세야 하므로 공구 전체 productId를 조인한다.
  const groupProductIds = getGroupConfigProductIds(orders, saleType);
  const groupConfigMap = useGroupConfigs(groupProductIds, saleType === 'group');
  const orderAlertMeta = getOrderAlertMeta(orders, saleType, groupConfigMap);

  const filteredOrders = orders.filter((o) => {
    if (saleType === 'group' ? o.saleType !== 'group' : o.saleType === 'group') return false;
    if (STATUS_GROUP_MAP[o.status] !== activeTab) return false;
    if (activeTab === 'IN_DELIVERY' && subFilter !== 'ALL' && o.status !== subFilter) {
      return false;
    }
    if (dateRange) {
      const d = getOrderDate(o, activeTab, groupConfigMap);
      // requestedDeliveryDate = null(공동구매 등)은 제외하지 않고 "날짜 미정"으로 내려보냄 (T6)
      if (
        d &&
        !isOrderOverdue(o, activeTab, groupConfigMap) &&
        (d < dateRange.from || d > dateRange.to)
      ) {
        return false;
      }
    }
    return true;
  });

  const bulkActionMode = activeTab === 'WAITING' ? 'shipParcel' : 'prepare';
  const bulkEligibleIds = useMemo(
    () =>
      bulkActionMode === 'shipParcel'
        ? getBulkParcelShipEligibleIds(filteredOrders)
        : getBulkPrepareEligibleIds(filteredOrders),
    [bulkActionMode, filteredOrders],
  );
  const selectedBulkOrders = useMemo(
    () =>
      filteredOrders.filter(
        (order) =>
          selectedOrderIds.has(order.id) &&
          (bulkActionMode === 'shipParcel'
            ? canBulkShipParcelOrder(order)
            : canBulkPrepareOrder(order)),
      ),
    [bulkActionMode, filteredOrders, selectedOrderIds],
  );

  useEffect(() => {
    setSelectedOrderIds((current) => {
      const eligible = new Set(bulkEligibleIds);
      const next = new Set([...current].filter((id) => eligible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [bulkEligibleIds]);

  const resetDateFilters = () => {
    setDatePreset('week');
    setCustomFrom('');
    setCustomTo('');
  };

  const openActionRequired = () => {
    clearBulkSelection();
    setActiveTab('ACTION_REQUIRED');
    setSubFilter('ALL');
    resetDateFilters();
  };

  const openOverdue = (tab: OrderGroup) => {
    clearBulkSelection();
    setActiveTab(tab);
    setSubFilter('ALL');
    resetDateFilters();
  };

  const setOrderSelected = (orderId: string, selected: boolean) => {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (selected) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  };

  const selectAllBulkEligible = () => {
    setSelectedOrderIds(new Set(bulkEligibleIds));
  };

  const handleBulkPrepare = async () => {
    if (!storeId || selectedBulkOrders.length === 0) return;
    setBulkLoading(true);
    try {
      const token = session?.user.accessToken ?? '';
      const results = await Promise.allSettled(
        selectedBulkOrders.map((order) =>
          apiJson(`/stores/${storeId}/orders/${order.id}/status`, token, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'PREPARING' }),
          }),
        ),
      );
      const summary = summarizeBulkActionResults(selectedBulkOrders, results);
      setSelectedOrderIds((current) => {
        return new Set([...current].filter((id) => !summary.completedIds.has(id)));
      });
      setBulkConfirmOpened(false);
      notifications.show(bulkActionNotification('prepare', summary));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkParcelShip = async (payloads: BulkParcelShipPayload[]) => {
    if (!storeId || payloads.length === 0) return;
    setBulkLoading(true);
    try {
      const token = session?.user.accessToken ?? '';
      const payloadByOrderId = new Map(payloads.map((payload) => [payload.orderId, payload]));
      const results = await Promise.allSettled(
        selectedBulkOrders.map((order) => {
          const payload = payloadByOrderId.get(order.id);
          return apiJson(`/stores/${storeId}/orders/${order.id}/status`, token, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'DELIVERED',
              courierCompany: payload?.courierCompany,
              trackingNumber: payload?.trackingNumber,
            }),
          });
        }),
      );
      const summary = summarizeBulkActionResults(selectedBulkOrders, results);
      setSelectedOrderIds((current) => {
        return new Set([...current].filter((id) => !summary.completedIds.has(id)));
      });
      setBulkParcelShipOpened(false);
      notifications.show(bulkActionNotification('parcelShip', summary));
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="주문 관리"
        right={<ConnectionStatus loading={loading} error={error} firebaseReady={firebaseReady} />}
      />

      {/* 판매 유형 토글 — 일반/공구 1차 분기 */}
      <SaleTypeToggle value={saleType} onChange={handleSaleTypeChange} />

      {/* 날짜 범위 필터 — 일반 토글에서만 노출 (공구는 1차 미노출) */}
      {saleType === 'normal' && (
        <Box
          style={{
            backgroundColor: 'var(--color-bg)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <Container size="sm" py="xs">
            <Group gap="xs">
              {DATE_PRESETS.map((p) => (
                <UnstyledButton
                  key={p.key}
                  onClick={() => {
                    clearBulkSelection();
                    setDatePreset(p.key);
                  }}
                  style={{
                    padding: '6px 14px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 99,
                    backgroundColor:
                      datePreset === p.key ? 'var(--color-text)' : 'var(--color-surface-muted)',
                    color: datePreset === p.key ? 'var(--color-bg)' : 'var(--color-text-disabled)',
                    transition: 'all 0.15s',
                  }}
                >
                  {p.label}
                </UnstyledButton>
              ))}
            </Group>

            {datePreset === 'custom' && (
              <Group gap="xs" mt="xs" align="center">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => {
                    clearBulkSelection();
                    setCustomFrom(e.target.value);
                  }}
                  style={{
                    padding: '6px 10px',
                    fontSize: 'var(--font-size-sm)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    color: 'var(--color-text)',
                  }}
                />
                <Text style={{ color: 'var(--color-text-disabled)' }}>~</Text>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => {
                    clearBulkSelection();
                    setCustomTo(e.target.value);
                  }}
                  style={{
                    padding: '6px 10px',
                    fontSize: 'var(--font-size-sm)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    color: 'var(--color-text)',
                  }}
                />
              </Group>
            )}

            {customInvalid && (
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                mt={4}
              >
                시작일이 종료일보다 늦습니다
              </Text>
            )}
          </Container>
        </Box>
      )}

      {/* 상태 탭 */}
      <SegmentedTabs
        tabs={GROUP_TABS.map((tab) => ({
          key: tab.key,
          label: tab.label,
          count: groupCounts[tab.key],
          badgeColor: tab.key === 'ACTION_REQUIRED' ? 'red' : 'gray',
        }))}
        value={activeTab}
        onChange={(key) => {
          clearBulkSelection();
          setActiveTab(key);
          setSubFilter('ALL');
        }}
        sticky
        layout="scroll"
      />

      {/* SubFilter — IN_DELIVERY 탭 선택 시에만 렌더링 */}
      {activeTab === 'IN_DELIVERY' && (
        <Box
          style={{
            backgroundColor: 'var(--color-surface-muted)',
            borderBottom: '1px solid var(--color-border)',
            padding: '6px 0',
          }}
        >
          <Container size="sm">
            <Group gap={0}>
              {IN_DELIVERY_SUBFILTERS.map((sf) => (
                <UnstyledButton
                  key={sf.key}
                  onClick={() => {
                    clearBulkSelection();
                    setSubFilter(sf.key);
                  }}
                  style={{
                    padding: '6px 14px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 99,
                    backgroundColor: subFilter === sf.key ? 'var(--color-text)' : 'transparent',
                    color: subFilter === sf.key ? 'var(--color-bg)' : 'var(--color-text-disabled)',
                    transition: 'all 0.15s',
                  }}
                >
                  {sf.label}
                </UnstyledButton>
              ))}
            </Group>
          </Container>
        </Box>
      )}

      {/* 주문 목록 — 날짜 그룹 섹션 */}
      <Container size="sm" px="md" py="md">
        <Stack gap="lg">
          {!loading && firebaseReady && (
            <OrderPriorityAlert
              meta={orderAlertMeta}
              onOpenActionRequired={openActionRequired}
              onOpenOverdue={openOverdue}
            />
          )}

          {!loading && firebaseReady && (
            <OrderBulkActionBar
              mode={bulkActionMode}
              eligibleCount={bulkEligibleIds.length}
              selectedCount={selectedBulkOrders.length}
              loading={bulkLoading}
              onSelectAll={selectAllBulkEligible}
              onClear={clearBulkSelection}
              onSubmit={() => {
                if (bulkActionMode === 'shipParcel') setBulkParcelShipOpened(true);
                else setBulkConfirmOpened(true);
              }}
            />
          )}

          {(loading || !firebaseReady) && <LoadingState />}

          {!loading && firebaseReady && filteredOrders.length === 0 && (
            <EmptyState
              icon={
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              }
              text="현재 해당 주문이 없습니다"
            />
          )}

          {!loading &&
            firebaseReady &&
            groupOrdersByDate(filteredOrders, activeTab, groupConfigMap).map((group) => (
              <DateSection
                key={group.dateKey}
                meta={getGroupHeaderMeta(group.dateKey, isArchiveTab(activeTab))}
                orders={group.orders}
                selectedOrderIds={selectedOrderIds}
                bulkActionMode={bulkActionMode}
                onSelectedChange={setOrderSelected}
              />
            ))}
        </Stack>
      </Container>

      <ConfirmModal
        opened={bulkConfirmOpened}
        title="선택한 주문을 준비 중으로 바꿀까요?"
        message={`${selectedBulkOrders.length}건의 주문을 한 번에 준비 중으로 변경합니다.`}
        confirmLabel="준비 시작"
        confirmColor="brand"
        loading={bulkLoading}
        onConfirm={handleBulkPrepare}
        onClose={() => {
          if (!bulkLoading) setBulkConfirmOpened(false);
        }}
      />
      <BulkParcelShipModal
        opened={bulkParcelShipOpened}
        orders={selectedBulkOrders}
        loading={bulkLoading}
        onConfirm={handleBulkParcelShip}
        onClose={() => {
          if (!bulkLoading) setBulkParcelShipOpened(false);
        }}
      />
    </PageShell>
  );
}
