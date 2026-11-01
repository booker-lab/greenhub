'use client';

import type { SaleType } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useFirebaseReady } from '@/app/providers';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { RoundDeadlineStrip } from '@/components/RoundDeadlineStrip';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useGroupConfigs } from '@/hooks/useGroupConfigs';
import { useOrderPhoneSearch } from '@/hooks/useOrderPhoneSearch';
import { useOrderArchive } from '@/hooks/useOrderArchive';
import { ACTIVE_SELLER_ORDERS_QUERY, useOrders } from '@/hooks/useOrders';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { useStoreSalesMode } from '@/hooks/useStoreSalesMode';
import { pickDeadlineRound } from '@/lib/round-deadline';
import { showsGroupBuyChoice } from '@/lib/sales-mode';
import { DateSection } from './_components/DateSection';
import { OrderSearchInput } from './_components/OrderSearchInput';
import { SaleTypeToggle } from './_components/SaleTypeToggle';
import {
  DATE_PRESETS,
  DEFAULT_DATE_PRESET,
  type DateRangePreset,
  GROUP_TABS,
  getGroupHeaderMeta,
  IN_DELIVERY_SUBFILTERS,
  isArchiveTab,
  type OrderGroup,
} from './_constants';
import { readOrdersDeepLink } from './orders-deep-link';
import { phoneSearchDigits } from './order-search';
import {
  buildOrdersScopedViewModel,
  deriveOrdersFetchInput,
  filterOrdersByRound,
  mergeActiveAndArchivedOrders,
} from './orders-view-model';

// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px, 좌우 16px)·Paper(radius lg = 16px, shadow xs)·
// Group·Stack·SimpleGrid·Text(p, 여백 0, 줄 높이 1.55)·UnstyledButton과 같은 값.
const TEXT = 'm-0 p-0 text-base';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';
const CONTAINER = 'mx-auto max-w-[720px] px-4';
const PAPER = 'block rounded-[16px] bg-white';
// ② 디자인 방향(D2·§3.2): 카드는 그림자 없이 틀(--frame) 위 흰 면, 선택 칩은 초록 면 대신 검정 테두리·굵기.
// 칩 띠(검색·날짜·보조 필터)는 틀과 같은 --frame이고 띠 사이 선을 긋지 않는다(D3).
function chipStyle(selected: boolean, idleBackground: string) {
  return {
    padding: '6px 14px',
    fontSize: 'var(--font-size-sm)',
    borderRadius: 99,
    border: `1px solid ${selected ? 'var(--color-text)' : 'transparent'}`,
    backgroundColor: selected ? 'var(--color-bg)' : idleBackground,
    color: selected ? 'var(--color-text)' : 'var(--color-text-secondary)',
    fontWeight: selected ? 'var(--fw-bold)' : undefined,
  } as const;
}
const GROUP = 'flex flex-row flex-wrap items-center justify-start';
const GROUP_NOWRAP_BETWEEN = 'flex flex-row flex-nowrap items-center justify-between gap-2.5';

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
    <button
      type="button"
      className={UNSTYLED_BUTTON}
      onClick={onClick}
      aria-label={`${label} ${count.toLocaleString()}건 확인`}
      style={{
        width: '100%',
        padding: 14,
        borderRadius: 12,
        backgroundColor: urgent ? 'var(--color-danger-surface)' : 'var(--frame)',
        textAlign: 'left',
      }}
    >
      <div className={GROUP_NOWRAP_BETWEEN}>
        <p
          className={TEXT}
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: urgent ? 'var(--color-danger)' : 'var(--color-text)',
          }}
        >
          {label}
        </p>
        <p
          className={TEXT}
          style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--fw-bold)',
            color: urgent ? 'var(--color-danger)' : 'var(--color-text)',
          }}
        >
          {count.toLocaleString()}건
        </p>
      </div>
      <p
        className={`${TEXT} mt-1`}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        {description}
      </p>
    </button>
  );
}

export default function OrdersPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const firebaseReady = useFirebaseReady();
  const { rounds } = useSaleRounds();
  const deadlineRound = useMemo(() => pickDeadlineRound(rounds), [rounds]);
  const [saleType, setSaleType] = useState<SaleType>('normal');
  const salesMode = useStoreSalesMode(storeId, session?.user.accessToken);
  const [activeTab, setActiveTab] = useState<OrderGroup>('ACTION_REQUIRED');
  const [subFilter, setSubFilter] = useState<'ALL' | 'DELIVERING' | 'HUB_ARRIVED'>('ALL');
  const [heldOnly, setHeldOnly] = useState(false);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(DEFAULT_DATE_PRESET);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // 입력창은 글자마다 바로 바뀌고, 목록 다시 계산·카드 렌더는 입력이 멈출 때 따라온다.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [roundFilter, setRoundFilter] = useState<string | null>(null);
  // 모든 기간의 주문을 통째로 받지 않는다. 회차 필터가 있으면 그 회차 주문 전부(완료·취소 포함)를,
  // 없으면 진행 중 주문 전부를 받고, 끝난 주문(완료·취소)은 그 탭을 처음 열 때부터 50건씩 받는다.
  const base = useOrders(
    storeId,
    roundFilter ? { roundId: roundFilter } : ACTIVE_SELLER_ORDERS_QUERY,
  );
  const archiveView = !roundFilter && isArchiveTab(activeTab);
  const archive = useOrderArchive(storeId, archiveView);
  const { loading, refreshing, error } = base;
  const orders = useMemo(
    () => (roundFilter ? base.orders : mergeActiveAndArchivedOrders(base.orders, archive.orders)),
    [roundFilter, base.orders, archive.orders],
  );
  // 끝난 주문을 아직 다 받지 않았으면 완료·취소 탭 건수를 확정하지 않는다(받은 것만 세면 실제보다 적다).
  const archiveCountsIncomplete = !roundFilter && (!archive.loaded || archive.hasMore);
  // 완료·취소 탭의 첫 페이지를 받기 전에는 빈 목록 대신 불러오는 중으로 보인다.
  const listLoading = loading || (archiveView && !archive.loaded && !archive.error);
  const refresh = () => {
    base.refresh();
    if (!roundFilter && archive.loaded) archive.refresh();
  };
  const phoneSearch = useOrderPhoneSearch(storeId, phoneSearchDigits(searchQuery));
  const { phoneMatchIds } = phoneSearch;
  const roundFilterName = roundFilter
    ? (rounds.find((round) => round.id === roundFilter)?.name ?? null)
    : null;

  useEffect(() => {
    const deepLink = readOrdersDeepLink(window.location.search);
    if (deepLink.tab) setActiveTab(deepLink.tab);
    if (deepLink.heldOnly) setHeldOnly(true);
    if (deepLink.roundId) setRoundFilter(deepLink.roundId);
  }, []);

  const clearRoundFilter = () => {
    setRoundFilter(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

  // 회차 필터(`?round=`)가 있으면 그 회차 주문만 이후 단계로 보낸다(뱃지·목록·우선순위 모두 같은 범위).
  const roundScopedOrders = useMemo(
    () => filterOrdersByRound(orders, roundFilter),
    [orders, roundFilter],
  );

  // PHASE_1_INPUT_DERIVATION → fetch boundary → PHASE_2_VIEW_MODEL.
  // useGroupConfigs가 productIds fetch를 필요로 하므로 단일 호출로 합칠 수 없고,
  // 두 순수 경계를 같은 saleTypeOrders 참조로 연결해 scope 중복을 제거한다.
  // 뱃지(counts)와 목록(filtered)은 PHASE_2 안에서 동일 참조로 파생된다.
  const fetchInput = useMemo(
    () => deriveOrdersFetchInput(roundScopedOrders, saleType, activeTab),
    [roundScopedOrders, saleType, activeTab],
  );
  const groupConfigs = useGroupConfigs(
    fetchInput.groupProductIds,
    saleType === 'group' && firebaseReady,
  );
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
        search: { query: deferredSearchQuery, phoneMatchIds },
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
      deferredSearchQuery,
      phoneMatchIds,
    ],
  );
  const { priorityCounts, scopedGroupCounts, customInvalid, filteredOrders, groupedOrders } = view;

  const handleSaleTypeChange = (next: SaleType) => {
    setSaleType(next);
    setHeldOnly(false);
    setDatePreset(DEFAULT_DATE_PRESET);
    setCustomFrom('');
    setCustomTo('');
    setSearchQuery('');
  };

  // 우선순위 진입이 날짜 필터·검색어에 가려 대상을 숨기지 않도록 필터를 해제한다('모든 날짜').
  // 배송 보류 진입은 DELIVERY_HELD만 격리해 count와 목록을 1:1로 일치시키고,
  // 확인 필요 진입은 기존 ACTION_REQUIRED 전체를 유지한다.
  const handleDeliveryHeldEntry = () => {
    setActiveTab('ACTION_REQUIRED');
    setSubFilter('ALL');
    setHeldOnly(true);
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
    setSearchQuery('');
  };

  const handleActionRequiredEntry = () => {
    setActiveTab('ACTION_REQUIRED');
    setSubFilter('ALL');
    setHeldOnly(false);
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
    setSearchQuery('');
  };

  return (
    <PageShell>
      <PageHeader
        title="주문 관리"
        right={
          <div className={`${GROUP} gap-2.5`}>
            <ConnectionStatus
              loading={loading || refreshing}
              error={error}
              firebaseReady={firebaseReady}
              source="api"
            />
            <button
              type="button"
              className={UNSTYLED_BUTTON}
              onClick={refresh}
              disabled={loading || refreshing}
              aria-label="주문 목록 새로고침"
              aria-busy={loading || refreshing}
              style={{
                padding: '6px 14px',
                fontSize: 'var(--font-size-sm)',
                borderRadius: 99,
                backgroundColor:
                  loading || refreshing ? 'var(--color-surface-muted)' : 'var(--color-primary)',
                color: loading || refreshing ? 'var(--color-text-disabled)' : 'var(--color-bg)',
                opacity: loading || refreshing ? 0.7 : 1,
                cursor: loading || refreshing ? 'default' : 'pointer',
                flexShrink: 0,
              }}
            >
              {loading || refreshing ? '새로고침 중...' : '새로고침'}
            </button>
          </div>
        }
      />
      <RoundDeadlineStrip
        round={deadlineRound}
        showName
        href={deadlineRound ? `/sale-rounds/${deadlineRound.id}` : undefined}
      />

      {/* 회차 상세 "이 회차 주문"에서 들어오면 그 회차 주문만 보여 준다. */}
      {roundFilter && (
        <div className={`${CONTAINER} pt-4`}>
          <div className={`${PAPER} p-3`}>
            <div className={GROUP_NOWRAP_BETWEEN}>
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                {roundFilterName ?? '선택한 회차'} 주문만 보고 있어요
              </p>
              <button
                type="button"
                className={UNSTYLED_BUTTON}
                onClick={clearRoundFilter}
                style={{
                  padding: '6px 14px',
                  fontSize: 'var(--font-size-sm)',
                  borderRadius: 99,
                  backgroundColor: 'var(--color-surface-muted)',
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                }}
              >
                모든 주문 보기
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className={`${CONTAINER} pt-4`}>
          <div className={`${PAPER} p-4`}>
            <div className="mb-3 flex flex-row flex-wrap items-end justify-between gap-4">
              <div>
                <p
                  className={TEXT}
                  style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
                >
                  업무 우선순위
                </p>
                <p
                  className={`${TEXT} mt-0.5`}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  선택한 판매 유형의 확인할 주문입니다.
                </p>
              </div>
              <p
                className={TEXT}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                항목을 누르면 확인 필요 목록으로 이동
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2.5 min-[36em]:grid-cols-2">
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
            </div>
          </div>
        </div>
      )}

      {/* 판매 유형 토글 — 일반/공구 1차 분기. 공동구매가 없는 회차 판매 가게에는 숨긴다. */}
      {showsGroupBuyChoice(salesMode, saleType) && (
        <SaleTypeToggle value={saleType} onChange={handleSaleTypeChange} />
      )}
      <OrderSearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        phoneSearching={phoneSearch.searching}
        phoneSearchError={phoneSearch.error}
      />

      {/* 날짜 범위 필터 — 일반 토글에서만 노출 (공구는 1차 미노출) */}
      {saleType === 'normal' && (
        <div style={{ backgroundColor: 'var(--frame)' }}>
          <div className={`${CONTAINER} py-2.5`}>
            <div className={`${GROUP} gap-2.5`}>
              {DATE_PRESETS.map((p) => (
                <button
                  type="button"
                  className={UNSTYLED_BUTTON}
                  key={p.key}
                  onClick={() => setDatePreset(p.key)}
                  style={{
                    ...chipStyle(datePreset === p.key, 'var(--color-surface-muted)'),
                    transition: 'all 0.15s',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className={`${GROUP} mt-2.5 gap-2.5`}>
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
                <p className={TEXT} style={{ color: 'var(--color-text-disabled)' }}>
                  ~
                </p>
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
              </div>
            )}

            {customInvalid && (
              <p
                className={`${TEXT} mt-1`}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                시작일이 종료일보다 늦습니다
              </p>
            )}
          </div>
        </div>
      )}

      {/* 상태 탭 */}
      <SegmentedTabs
        tabs={GROUP_TABS.map((tab) => ({
          key: tab.key,
          label: tab.label,
          count:
            archiveCountsIncomplete && isArchiveTab(tab.key)
              ? undefined
              : scopedGroupCounts[tab.key],
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
        ariaLabel="주문 상태"
        variant="underline"
      />

      {/* SubFilter — ACTION_REQUIRED 탭의 배송 보류 격리 / IN_DELIVERY 탭 선택 시에만 렌더링 */}
      {activeTab === 'ACTION_REQUIRED' && (
        <div
          style={{
            backgroundColor: 'var(--frame)',
            padding: '6px 0',
          }}
        >
          <div className={CONTAINER}>
            <div className={`${GROUP} gap-0`}>
              <button
                type="button"
                className={UNSTYLED_BUTTON}
                onClick={() => setHeldOnly(false)}
                aria-pressed={!heldOnly}
                style={{ ...chipStyle(!heldOnly, 'transparent'), transition: 'all 0.15s' }}
              >
                전체
              </button>
              <button
                type="button"
                className={UNSTYLED_BUTTON}
                onClick={() => setHeldOnly(true)}
                aria-pressed={heldOnly}
                style={{ ...chipStyle(heldOnly, 'transparent'), transition: 'all 0.15s' }}
              >
                배송 보류
              </button>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'IN_DELIVERY' && (
        <div
          style={{
            backgroundColor: 'var(--frame)',
            padding: '6px 0',
          }}
        >
          <div className={CONTAINER}>
            <div className={`${GROUP} gap-0`}>
              {IN_DELIVERY_SUBFILTERS.map((sf) => (
                <button
                  type="button"
                  className={UNSTYLED_BUTTON}
                  key={sf.key}
                  onClick={() => setSubFilter(sf.key)}
                  style={{
                    ...chipStyle(subFilter === sf.key, 'transparent'),
                    transition: 'all 0.15s',
                  }}
                >
                  {sf.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 주문 목록 — 날짜 그룹 섹션 */}
      <div className={`${CONTAINER} py-4`}>
        <div className="flex flex-col gap-5">
          {(listLoading || (saleType === 'group' && !firebaseReady)) && <LoadingState />}

          {archiveView && archive.error && (
            <div className={`${PAPER} p-4`} role="alert">
              <div className={GROUP_NOWRAP_BETWEEN}>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  {archive.loaded
                    ? '끝난 주문을 더 불러오지 못했습니다.'
                    : '끝난 주문을 불러오지 못했습니다.'}
                </p>
                <button
                  type="button"
                  className={UNSTYLED_BUTTON}
                  onClick={archive.loaded ? archive.loadMore : archive.refresh}
                  style={{
                    padding: '6px 14px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 99,
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-bg)',
                    flexShrink: 0,
                  }}
                >
                  다시 시도
                </button>
              </div>
            </div>
          )}

          {!loading && error && orders.length === 0 && (
            <EmptyState
              text={error}
              action={
                <button
                  type="button"
                  className={UNSTYLED_BUTTON}
                  onClick={refresh}
                  style={{
                    padding: '6px 14px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 99,
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-bg)',
                  }}
                >
                  다시 시도
                </button>
              }
            />
          )}

          {!loading && error && orders.length > 0 && (
            <div className={`${PAPER} p-4`}>
              <div className={GROUP_NOWRAP_BETWEEN}>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  최신 주문을 불러오지 못했습니다. 이전 목록을 표시합니다.
                </p>
                <button
                  type="button"
                  className={UNSTYLED_BUTTON}
                  onClick={refresh}
                  style={{
                    padding: '6px 14px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 99,
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-bg)',
                    flexShrink: 0,
                  }}
                >
                  다시 시도
                </button>
              </div>
            </div>
          )}

          {/* 공구 배송일 auxiliary metadata — core 주문 목록과 분리.
              실패해도 주문 목록을 숨기거나 정상 empty로 속이지 않고,
              saleType/activeTab/filter state를 보존한 채 작은 warning/retry만 노출한다. */}
          {!loading && firebaseReady && saleType === 'group' && groupConfigs.error && (
            <div className={`${PAPER} p-4`}>
              <div className={GROUP_NOWRAP_BETWEEN}>
                <p
                  className={TEXT}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  {groupConfigs.isStale
                    ? '공구 배송일 정보를 새로 불러오지 못했습니다. 이전 정보를 표시합니다.'
                    : '공구 배송일 정보를 불러오지 못했습니다. 주문 목록은 그대로 표시됩니다.'}
                </p>
                <button
                  type="button"
                  className={UNSTYLED_BUTTON}
                  onClick={groupConfigs.retry}
                  aria-label="공구 배송일 다시 불러오기"
                  style={{
                    padding: '6px 14px',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 99,
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-bg)',
                    flexShrink: 0,
                  }}
                >
                  다시 시도
                </button>
              </div>
            </div>
          )}

          {!loading &&
            firebaseReady &&
            saleType === 'group' &&
            !groupConfigs.error &&
            groupConfigs.loading && (
              <p
                className={TEXT}
                aria-live="polite"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                공구 배송일 정보를 불러오는 중입니다…
              </p>
            )}

          {!listLoading &&
            !(archiveView && archive.error && !archive.loaded) &&
            (saleType !== 'group' || firebaseReady) &&
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
                text={
                  deferredSearchQuery.trim()
                    ? '검색어와 맞는 주문이 없습니다'
                    : '현재 해당 주문이 없습니다'
                }
              />
            )}

          {!listLoading &&
            (saleType !== 'group' || firebaseReady) &&
            !(error && orders.length === 0) &&
            groupedOrders.map((group) => (
              <DateSection
                key={group.dateKey}
                meta={getGroupHeaderMeta(group.dateKey, isArchiveTab(activeTab))}
                orders={group.orders}
              />
            ))}

          {archiveView && archive.loaded && archive.hasMore && (
            <button
              type="button"
              className={UNSTYLED_BUTTON}
              onClick={archive.loadMore}
              disabled={archive.loading}
              aria-busy={archive.loading}
              style={{
                alignSelf: 'center',
                padding: '8px 18px',
                fontSize: 'var(--font-size-sm)',
                borderRadius: 99,
                backgroundColor: 'var(--color-surface-muted)',
                color: archive.loading
                  ? 'var(--color-text-disabled)'
                  : 'var(--color-text-secondary)',
              }}
            >
              {archive.loading ? '불러오는 중...' : '지난 주문 더 보기'}
            </button>
          )}
        </div>
      </div>
    </PageShell>
  );
}
