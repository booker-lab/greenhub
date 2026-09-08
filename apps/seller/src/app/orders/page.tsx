'use client';

import type { SaleType } from '@greenhub/shared';
import {
  Box,
  Button,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { useFirebaseReady } from '@/app/providers';
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
import { filterOrdersByPriorityFocus, getOrderPriorityCounts } from './order-priority';
import type { PriorityFocus } from './order-priority';

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
  const firebaseReady = useFirebaseReady();
  const { orders, loading, error, refresh } = useOrders(storeId);
  const [saleType, setSaleType] = useState<SaleType>('normal');
  const [activeTab, setActiveTab] = useState<OrderGroup>('ACTION_REQUIRED');
  const [subFilter, setSubFilter] = useState<'ALL' | 'DELIVERING' | 'HUB_ARRIVED'>('ALL');
  const [priorityFocus, setPriorityFocus] = useState<PriorityFocus>('ALL');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const saleTypeOrders = useMemo(
    () =>
      orders.filter((order) =>
        saleType === 'group' ? order.saleType === 'group' : order.saleType !== 'group',
      ),
    [orders, saleType],
  );
  const priorityCounts = getOrderPriorityCounts(saleTypeOrders);
  // 탭 뱃지는 현재 판매 유형 범위를 그대로 사용해 목록 1차 분기와 일치시킨다.
  // useOrders의 전역 groupCounts는 홈/준비물량 등 다른 화면이 계속 사용한다.
  const tabCounts = useMemo(() => {
    const result: Record<OrderGroup, number> = {
      ACTION_REQUIRED: 0,
      WAITING: 0,
      IN_DELIVERY: 0,
      DONE: 0,
      CANCELLED: 0,
    };
    for (const order of saleTypeOrders) {
      result[STATUS_GROUP_MAP[order.status]] += 1;
    }
    return result;
  }, [saleTypeOrders]);

  const handleSaleTypeChange = (next: SaleType) => {
    setSaleType(next);
    setPriorityFocus('ALL');
    setDatePreset('week');
    setCustomFrom('');
    setCustomTo('');
  };

  const handleTabChange = (key: OrderGroup) => {
    setActiveTab(key);
    setSubFilter('ALL');
    setPriorityFocus('ALL');
  };

  // 우선순위 건수(판매 유형 범위)와 표시 집합을 일치시키기 위해
  // 우선순위 진입 시 날짜 범위를 해제한다. custom 빈 값은 getDateRange가 null을 반환해
  // 날짜 필터 미적용(전체 기간)이 되며, 사용자는 칩으로 다시 범위를 좁힐 수 있다.
  const handlePrioritySelect = (focus: PriorityFocus) => {
    setActiveTab('ACTION_REQUIRED');
    setSubFilter('ALL');
    setPriorityFocus(focus);
    setDatePreset('custom');
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

  const tabFiltered = saleTypeOrders.filter((o) => {
    if (STATUS_GROUP_MAP[o.status] !== activeTab) return false;
    if (activeTab === 'IN_DELIVERY' && subFilter !== 'ALL' && o.status !== subFilter) {
      return false;
    }
    return true;
  });
  // 배송 보류 카드는 ACTION_REQUIRED 부분집합만 표시한다. predicate는 order-priority와 공유한다.
  const focusFiltered =
    activeTab === 'ACTION_REQUIRED'
      ? filterOrdersByPriorityFocus(tabFiltered, priorityFocus)
      : tabFiltered;
  const filteredOrders = focusFiltered.filter((o) => {
    if (dateRange) {
      const d = getOrderDate(o, activeTab, groupConfigMap);
      // requestedDeliveryDate = null(공동구매 등)은 제외하지 않고 "날짜 미정"으로 내려보냄 (T6)
      if (d && (d < dateRange.from || d > dateRange.to)) return false;
    }
    return true;
  });

  // read/presentation 상태의 단일 분기 순서: LOADING > FETCH_ERROR > EMPTY > HAS_ORDERS.
  // error가 있으면 빈 목록 문구를 절대 표시하지 않는다.
  const isLoading = loading || !firebaseReady;
  const isFetchError = !isLoading && error !== null;

  return (
    <PageShell>
      <PageHeader
        title="주문 관리"
        right={
          <Group gap="xs" align="center">
            <ConnectionStatus
              loading={loading}
              error={error}
              firebaseReady={firebaseReady}
              source="api"
            />
            <UnstyledButton
              onClick={refresh}
              disabled={isLoading}
              data-testid="orders-refresh"
              aria-label="주문 목록 새로고침"
              style={{
                padding: '4px 10px',
                fontSize: 'var(--font-size-sm)',
                borderRadius: 99,
                border: '1px solid var(--color-border)',
                color: isLoading ? 'var(--color-text-disabled)' : 'var(--color-text)',
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              새로고침
            </UnstyledButton>
          </Group>
        }
      />

      {!isLoading && !isFetchError && (
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
                onClick={() => handlePrioritySelect('DELIVERY_HELD')}
              />
              <PriorityItem
                label="확인 필요"
                count={priorityCounts.actionRequired}
                description="기존 처리 필요 주문 상태를 모아 봅니다."
                urgent={priorityCounts.actionRequired > 0}
                onClick={() => handlePrioritySelect('ALL')}
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
          count: tabCounts[tab.key],
          badgeColor: tab.key === 'ACTION_REQUIRED' ? 'red' : 'gray',
        }))}
        value={activeTab}
        onChange={handleTabChange}
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
          {isLoading && <LoadingState />}

          {!isLoading && isFetchError && (
            <Paper
              radius="lg"
              shadow="xs"
              p="md"
              data-testid="orders-fetch-error"
              style={{ border: '1px solid var(--color-danger)' }}
            >
              <Text style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-danger)' }}>
                주문 목록을 불러오지 못했습니다
              </Text>
              <Text
                mt={4}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                {error}
              </Text>
              <Button
                mt="sm"
                size="sm"
                radius="md"
                color="red"
                variant="light"
                onClick={refresh}
                data-testid="orders-retry"
              >
                다시 시도
              </Button>
            </Paper>
          )}

          {!isLoading &&
            !isFetchError &&
            activeTab === 'ACTION_REQUIRED' &&
            priorityFocus === 'DELIVERY_HELD' && (
            <Paper radius="lg" shadow="xs" p="sm" data-testid="orders-priority-focus">
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  배송 보류 {priorityCounts.deliveryHeld.toLocaleString()}건만 보는 중
                </Text>
                <UnstyledButton
                  onClick={() => setPriorityFocus('ALL')}
                  aria-label="배송 보류 필터 해제"
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-primary)',
                    textDecoration: 'underline',
                  }}
                >
                  전체 보기
                </UnstyledButton>
              </Group>
            </Paper>
          )}

          {!isLoading && !isFetchError && filteredOrders.length === 0 && (
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

          {!isLoading &&
            !isFetchError &&
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
