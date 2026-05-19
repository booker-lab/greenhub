'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import type { SaleType } from '@greenhub/shared';
import { useOrders } from '@/hooks/useOrders';
import { useGroupConfigs } from '@/hooks/useGroupConfigs';
import { DateSection } from './_components/DateSection';
import { SaleTypeToggle } from './_components/SaleTypeToggle';
import {
  DATE_PRESETS,
  GROUP_TABS,
  STATUS_GROUP_MAP,
  IN_DELIVERY_SUBFILTERS,
  getDateRange,
  getGroupHeaderMeta,
  getOrderDate,
  groupOrdersByDate,
  isArchiveTab,
  type DateRangePreset,
  type OrderGroup,
} from './_constants';
import { Badge, Box, Container, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { ConnectionStatus } from '@/components/ConnectionStatus';

const VALID_TABS = new Set<OrderGroup>(['ACTION_REQUIRED', 'WAITING', 'IN_DELIVERY', 'DONE', 'CANCELLED']);

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
      ? orders
          .filter((o) => o.saleType === 'group' && STATUS_GROUP_MAP[o.status] === activeTab)
          .map((o) => o.productId)
      : [];
  const groupConfigMap = useGroupConfigs(groupProductIds, saleType === 'group');

  const filteredOrders = orders.filter((o) => {
    if (saleType === 'group' ? o.saleType !== 'group' : o.saleType === 'group') return false;
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
        right={
          <ConnectionStatus loading={loading} error={error} firebaseReady={firebaseReady} />
        }
      />

      {/* 판매 유형 토글 — 일반/공구 1차 분기 */}
      <SaleTypeToggle value={saleType} onChange={handleSaleTypeChange} />

      {/* 날짜 범위 필터 — 일반 토글에서만 노출 (공구는 1차 미노출) */}
      {saleType === 'normal' && (
        <Box style={{ backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
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
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }} mt={4}>
                시작일이 종료일보다 늦습니다
              </Text>
            )}
          </Container>
        </Box>
      )}

      {/* 상태 탭 */}
      <Box
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky',
          top: 'var(--header-height)',
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group gap={0} style={{ overflowX: 'auto', flexWrap: 'nowrap', scrollbarWidth: 'none' }}>
            {GROUP_TABS.map((tab) => (
              <UnstyledButton
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSubFilter('ALL'); }}
                style={{
                  flexShrink: 0,
                  padding: '12px 16px',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: activeTab === tab.key ? 700 : 400,
                  borderBottom: `2px solid ${activeTab === tab.key ? 'var(--color-text)' : 'transparent'}`,
                  color: activeTab === tab.key ? 'var(--color-text)' : 'var(--color-text-disabled)',
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
                {groupCounts[tab.key] > 0 && (
                  <Badge size="xs" ml={6} color={tab.key === 'ACTION_REQUIRED' ? 'red' : 'gray'}>
                    {groupCounts[tab.key]}
                  </Badge>
                )}
              </UnstyledButton>
            ))}
          </Group>
        </Container>
      </Box>

      {/* SubFilter — IN_DELIVERY 탭 선택 시에만 렌더링 */}
      {activeTab === 'IN_DELIVERY' && (
        <Box style={{ backgroundColor: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)', padding: '6px 0' }}>
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
