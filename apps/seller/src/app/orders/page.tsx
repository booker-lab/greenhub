'use client';

import type { SaleType } from '@greenhub/shared';
import {
  Box,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useGroupConfigs } from '@/hooks/useGroupConfigs';
import { useOrders } from '@/hooks/useOrders';
import { DateSection } from './_components/DateSection';
import { SaleTypeToggle } from './_components/SaleTypeToggle';
import {
  DATE_PRESETS,
  type DateRangePreset,
  GROUP_TABS,
  getDateRange,
  getGroupHeaderMeta,
  getOrderDate,
  groupOrdersByDate,
  IN_DELIVERY_SUBFILTERS,
  isArchiveTab,
  type OrderGroup,
  STATUS_GROUP_MAP,
} from './_constants';
import { getOrderPriorityCounts } from './order-priority';

const VALID_TABS = new Set<OrderGroup>([
  'ACTION_REQUIRED',
  'WAITING',
  'IN_DELIVERY',
  'DONE',
  'CANCELLED',
]);

function PriorityItem({
  label,
  count,
  description,
  urgent,
  onClick,
}: {
  label: string;
  count: number;
  description: string;
  urgent: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      aria-label={`${label} ${count.toLocaleString()}건 확인`}
      style={{
        width: '100%',
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${urgent ? 'var(--color-danger)' : 'var(--color-border)'}`,
        backgroundColor: urgent ? 'var(--color-danger-surface)' : 'var(--color-bg)',
        textAlign: 'left',
      }}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: urgent ? 'var(--color-danger)' : 'var(--color-text)',
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--fw-bold)',
            color: urgent ? 'var(--color-danger)' : 'var(--color-text)',
          }}
        >
          {count.toLocaleString()}건
        </Text>
      </Group>
      <Text
        mt={4}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        {description}
      </Text>
    </UnstyledButton>
  );
}

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

  const saleTypeOrders = orders.filter((order) =>
    saleType === 'group' ? order.saleType === 'group' : order.saleType !== 'group',
  );
  const priorityCounts = getOrderPriorityCounts(saleTypeOrders);

  const handleSaleTypeChange = (next: SaleType) => {
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

  // 공구 토글일 때만 표시 후보 productId를 모아 groupProductConfig 일괄 fetch
  const groupProductIds =
    saleType === 'group'
      ? saleTypeOrders
          .filter((o) => STATUS_GROUP_MAP[o.status] === activeTab)
          .map((o) => o.productId)
      : [];
  const groupConfigMap = useGroupConfigs(groupProductIds, saleType === 'group');

  const filteredOrders = saleTypeOrders.filter((o) => {
    if (STATUS_GROUP_MAP[o.status] !== activeTab) return false;
    if (activeTab === 'IN_DELIVERY' && subFilter !== 'ALL' && o.status !== subFilter) {
      return false;
    }
    if (dateRange) {
      const d = getOrderDate(o, activeTab, groupConfigMap);
      // requestedDeliveryDate = null(공동구매 등)은 제외하지 않고 "날짜 미정"으로 내려보냄 (T6)
      if (d && (d < dateRange.from || d > dateRange.to)) return false;
    }
    return true;
  });

  return (
    <PageShell>
      <PageHeader
        title="주문 관리"
        right={<ConnectionStatus loading={loading} error={error} firebaseReady={firebaseReady} />}
      />

      {!loading && firebaseReady && (
        <Container size="sm" px="md" pt="md">
          <Paper radius="lg" shadow="xs" p="md">
            <Group justify="space-between" align="flex-end" mb="sm">
              <Box>
                <Text style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
                  업무 우선순위
                </Text>
                <Text
                  mt={2}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  선택한 판매 유형의 확인할 주문입니다.
                </Text>
              </Box>
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                항목을 누르면 확인 필요 목록으로 이동
              </Text>
            </Group>
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
              <PriorityItem
                label="배송 보류"
                count={priorityCounts.deliveryHeld}
                description="배송 일정과 고객 안내를 먼저 확인하세요."
                urgent={priorityCounts.deliveryHeld > 0}
                onClick={() => {
                  setActiveTab('ACTION_REQUIRED');
                  setSubFilter('ALL');
                }}
              />
              <PriorityItem
                label="확인 필요"
                count={priorityCounts.actionRequired}
                description="기존 처리 필요 주문 상태를 모아 봅니다."
                urgent={priorityCounts.actionRequired > 0}
                onClick={() => {
                  setActiveTab('ACTION_REQUIRED');
                  setSubFilter('ALL');
                }}
              />
            </SimpleGrid>
          </Paper>
        </Container>
      )}

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
                  onClick={() => setDatePreset(p.key)}
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
                  onChange={(e) => setCustomFrom(e.target.value)}
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
                  onChange={(e) => setCustomTo(e.target.value)}
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
                  onClick={() => setSubFilter(sf.key)}
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
              />
            ))}
        </Stack>
      </Container>
    </PageShell>
  );
}
