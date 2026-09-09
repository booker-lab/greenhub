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
  getGroupHeaderMeta,
  IN_DELIVERY_SUBFILTERS,
  isArchiveTab,
  type OrderGroup,
} from './_constants';
import {
  buildOrdersScopedViewModel,
  deriveOrdersFetchInput,
} from './orders-view-model';

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
  const { orders, loading, refreshing, error, refresh } = useOrders(storeId);
  const [saleType, setSaleType] = useState<SaleType>('normal');
  const [activeTab, setActiveTab] = useState<OrderGroup>('ACTION_REQUIRED');
  const [subFilter, setSubFilter] = useState<'ALL' | 'DELIVERING' | 'HUB_ARRIVED'>('ALL');
  const [heldOnly, setHeldOnly] = useState(false);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as OrderGroup | null;
    if (tab && VALID_TABS.has(tab)) setActiveTab(tab);
  }, []);

  // PHASE_1_INPUT_DERIVATION → fetch boundary → PHASE_2_VIEW_MODEL.
  // useGroupConfigs가 productIds fetch를 필요로 하므로 단일 호출로 합칠 수 없고,
  // 두 순수 경계를 같은 saleTypeOrders 참조로 연결해 scope 중복을 제거한다.
  // 뱃지(counts)와 목록(filtered)은 PHASE_2 안에서 동일 참조로 파생된다.
  const fetchInput = useMemo(
    () => deriveOrdersFetchInput(orders, saleType, activeTab),
    [orders, saleType, activeTab],
  );
  const groupConfigs = useGroupConfigs(fetchInput.groupProductIds, saleType === 'group');
  const groupConfigMap = groupConfigs.map;
  const view = useMemo(
    () =>
      buildOrdersScopedViewModel({
        saleTypeOrders: fetchInput.saleTypeOrders,
        saleType,
        activeTab,
        subFilter,
        heldOnly,
        datePreset,
        customFrom,
        customTo,
        groupConfigMap,
      }),
    [
      fetchInput,
      saleType,
      activeTab,
      subFilter,
      heldOnly,
      datePreset,
      customFrom,
      customTo,
      groupConfigMap,
    ],
  );
  const { priorityCounts, scopedGroupCounts, customInvalid, filteredOrders, groupedOrders } = view;

  const handleSaleTypeChange = (next: SaleType) => {
    setSaleType(next);
    setHeldOnly(false);
    setDatePreset('week');
    setCustomFrom('');
    setCustomTo('');
  };

  // 우선순위 진입이 날짜 필터에 가려 대상을 숨기지 않도록 필터를 해제한다.
  // 배송 보류 진입은 DELIVERY_HELD만 격리해 count와 목록을 1:1로 일치시키고,
  // 확인 필요 진입은 기존 ACTION_REQUIRED 전체를 유지한다.
  const handleDeliveryHeldEntry = () => {
    setActiveTab('ACTION_REQUIRED');
    setSubFilter('ALL');
    setHeldOnly(true);
    setDatePreset('custom');
    setCustomFrom('');
    setCustomTo('');
  };

  const handleActionRequiredEntry = () => {
    setActiveTab('ACTION_REQUIRED');
    setSubFilter('ALL');
    setHeldOnly(false);
    setDatePreset('custom');
    setCustomFrom('');
    setCustomTo('');
  };

  return (
    <PageShell>
      <PageHeader
        title="주문 관리"
        right={
          <Group gap="xs" align="center">
            <ConnectionStatus
              loading={loading || refreshing}
              error={error}
              firebaseReady={firebaseReady}
              source="api"
            />
            <UnstyledButton
              onClick={refresh}
              disabled={loading || refreshing}
              aria-label="주문 목록 새로고침"
              aria-busy={loading || refreshing}
              style={{
                padding: '6px 14px',
                fontSize: 'var(--font-size-sm)',
                borderRadius: 99,
                backgroundColor:
                  loading || refreshing ? 'var(--color-surface-muted)' : 'var(--color-text)',
                color:
                  loading || refreshing ? 'var(--color-text-disabled)' : 'var(--color-bg)',
                opacity: loading || refreshing ? 0.7 : 1,
                cursor: loading || refreshing ? 'default' : 'pointer',
                flexShrink: 0,
              }}
            >
              {loading || refreshing ? '새로고침 중...' : '새로고침'}
            </UnstyledButton>
          </Group>
        }
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
                onClick={handleDeliveryHeldEntry}
              />
              <PriorityItem
                label="확인 필요"
                count={priorityCounts.actionRequired}
                description="기존 처리 필요 주문 상태를 모아 봅니다."
                urgent={priorityCounts.actionRequired > 0}
                onClick={handleActionRequiredEntry}
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
          count: scopedGroupCounts[tab.key],
          badgeColor: tab.key === 'ACTION_REQUIRED' ? 'red' : 'gray',
        }))}
        value={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setSubFilter('ALL');
          setHeldOnly(false);
        }}
        sticky
        layout="scroll"
      />

      {/* SubFilter — ACTION_REQUIRED 탭의 배송 보류 격리 / IN_DELIVERY 탭 선택 시에만 렌더링 */}
      {activeTab === 'ACTION_REQUIRED' && (
        <Box
          style={{
            backgroundColor: 'var(--color-surface-muted)',
            borderBottom: '1px solid var(--color-border)',
            padding: '6px 0',
          }}
        >
          <Container size="sm">
            <Group gap={0}>
              <UnstyledButton
                onClick={() => setHeldOnly(false)}
                aria-pressed={!heldOnly}
                style={{
                  padding: '6px 14px',
                  fontSize: 'var(--font-size-sm)',
                  borderRadius: 99,
                  backgroundColor: !heldOnly ? 'var(--color-text)' : 'transparent',
                  color: !heldOnly ? 'var(--color-bg)' : 'var(--color-text-disabled)',
                  transition: 'all 0.15s',
                }}
              >
                전체
              </UnstyledButton>
              <UnstyledButton
                onClick={() => setHeldOnly(true)}
                aria-pressed={heldOnly}
                style={{
                  padding: '6px 14px',
                  fontSize: 'var(--font-size-sm)',
                  borderRadius: 99,
                  backgroundColor: heldOnly ? 'var(--color-text)' : 'transparent',
                  color: heldOnly ? 'var(--color-bg)' : 'var(--color-text-disabled)',
                  transition: 'all 0.15s',
                }}
              >
                배송 보류
              </UnstyledButton>
            </Group>
          </Container>
        </Box>
      )}
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

          {!loading && firebaseReady && error && orders.length === 0 && (
            <EmptyState
              text={error}
              action={
                <UnstyledButton
                  onClick={refresh}
                  style={{
                    padding: '6px 14px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 99,
                    backgroundColor: 'var(--color-text)',
                    color: 'var(--color-bg)',
                  }}
                >
                  다시 시도
                </UnstyledButton>
              }
            />
          )}

          {!loading && firebaseReady && error && orders.length > 0 && (
            <Paper radius="lg" shadow="xs" p="md">
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  최신 주문을 불러오지 못했습니다. 이전 목록을 표시합니다.
                </Text>
                <UnstyledButton
                  onClick={refresh}
                  style={{
                    padding: '6px 14px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 99,
                    backgroundColor: 'var(--color-text)',
                    color: 'var(--color-bg)',
                    flexShrink: 0,
                  }}
                >
                  다시 시도
                </UnstyledButton>
              </Group>
            </Paper>
          )}

          {/* 공구 배송일 auxiliary metadata — core 주문 목록과 분리.
              실패해도 주문 목록을 숨기거나 정상 empty로 속이지 않고,
              saleType/activeTab/filter state를 보존한 채 작은 warning/retry만 노출한다. */}
          {!loading &&
            firebaseReady &&
            saleType === 'group' &&
            groupConfigs.error && (
              <Paper radius="lg" shadow="xs" p="md">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                  >
                    {groupConfigs.isStale
                      ? '공구 배송일 정보를 새로 불러오지 못했습니다. 이전 정보를 표시합니다.'
                      : '공구 배송일 정보를 불러오지 못했습니다. 주문 목록은 그대로 표시됩니다.'}
                  </Text>
                  <UnstyledButton
                    onClick={groupConfigs.retry}
                    aria-label="공구 배송일 다시 불러오기"
                    style={{
                      padding: '6px 14px',
                      fontSize: 'var(--font-size-sm)',
                      borderRadius: 99,
                      backgroundColor: 'var(--color-text)',
                      color: 'var(--color-bg)',
                      flexShrink: 0,
                    }}
                  >
                    다시 시도
                  </UnstyledButton>
                </Group>
              </Paper>
            )}

          {!loading &&
            firebaseReady &&
            saleType === 'group' &&
            !groupConfigs.error &&
            groupConfigs.loading && (
              <Text
                aria-live="polite"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                공구 배송일 정보를 불러오는 중입니다…
              </Text>
            )}

          {!loading &&
            firebaseReady &&
            !(error && orders.length === 0) &&
            filteredOrders.length === 0 && (
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
            !(error && orders.length === 0) &&
            groupedOrders.map((group) => (
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
