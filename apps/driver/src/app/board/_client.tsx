'use client';

import { apiPathSegment } from '@greenhub/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AppButton } from '@/components/app-button';
import { text } from '@/components/look';
import OrderCard, { type DriverListOrder, type OrderRowSelection } from '@/components/OrderCard';
import { apiFetch, apiRead } from '@/lib/api';
import {
  buildDriverListScope,
  shouldPreserveDriverListOnReadError,
  toDriverListReadError,
  toDriverListReadErrorKind,
} from '@/lib/driver-list-read';
import { groupDeliveringOrders, takeDeliveringFirstScreen } from '@/lib/delivering-groups';
import { readDriverSummaryCompletedToday } from '@/lib/driver-summary';
import { groupPreparingOrders, takePreparingFirstScreen } from '@/lib/preparing-groups';
import { BatchPickupConfirmDialog } from './_components/BatchPickupConfirmDialog';
import {
  BATCH_PICKUP_TARGET_STATUS,
  type BatchPickupSummary,
  batchPickupBlockLabel,
  batchPickupBlockReason,
  buildBatchPickupConfirmContent,
  buildBatchPickupSummaryText,
  isBatchPickupSelectable,
  runBatchPickup,
  summarizeBatchPickup,
} from './_lib/batch-pickup';

/** 한 번에 수거 고르기 행 상태. null이면 고르기 모드가 아니다. */
type BatchSelection = {
  selectedIds: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (orderId: string) => void;
};

/** 복귀 재조회 묶음 간격. focus·visibilitychange가 이 간격 안에 겹치면 목록을 한 번만 다시 조회한다. */
const REVALIDATE_COALESCE_MS = 1_500;

export default function BoardClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const tab = searchParams.get('tab') ?? 'preparing';

  const [preparing, setPreparing] = useState<DriverListOrder[]>([]);
  const [delivering, setDelivering] = useState<DriverListOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasSuccessfulRead, setHasSuccessfulRead] = useState(false);
  const requestIdRef = useRef(0);
  const hasSuccessfulReadRef = useRef(false);
  // user identity + role + access token scope가 바뀌면 이전 scope의
  // protected rows를 새 fetch 완료 전에 동기적으로 제거한다.
  const listScopeRef = useRef<string | null>(null);
  // 오늘 완료 수(GET /driver/summary). 조회 실패·필드 없음이면 null이고 진행 줄의 그 부분만 숨긴다.
  const [completedToday, setCompletedToday] = useState<number | null>(null);

  // 한 번에 수거: 고르기 모드·고른 주문·확인 창·실행 중·결과 요약.
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchPickupSummary | null>(null);
  // 실행 권한은 React state가 아니라 ref다. 같은 프레임의 두 번 누름도 두 번째 실행을 막는다.
  const batchInFlightRef = useRef(false);
  // 실행 세대. 화면 이탈·scope 전환·인증 상실이 올리면 이전 실행은 남은 요청을 보내지 않고 화면에 쓰지 않는다.
  const batchSeqRef = useRef(0);
  const mountedRef = useRef(false);
  // 렌더 중 동기 갱신되는 live scope: 실행 중 세션이 바뀌면 effect 실행 전에도 남은 요청을 멈춘다.
  const liveListScopeRef = useRef<string | null>(null);
  liveListScopeRef.current = session?.user.accessToken
    ? buildDriverListScope({
        userId: session.user.id,
        role: session.user.role,
        token: session.user.accessToken,
      })
    : '__no_token__';

  // 화면을 떠나면 진행 중인 한 번에 수거의 남은 요청을 보내지 않는다.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      batchSeqRef.current += 1;
    };
  }, []);

  // 한 번에 수거 상태를 모두 버린다. 진행 중 실행은 세대가 바뀌어 남은 요청을 보내지 않는다.
  const resetBatch = () => {
    batchSeqRef.current += 1;
    batchInFlightRef.current = false;
    setBatchMode(false);
    setSelectedIds(new Set());
    setBatchConfirmOpen(false);
    setBatchRunning(false);
    setBatchProgress(null);
    setBatchSummary(null);
  };

  // focus 복귀·visibility 복귀 시 새 read를 수행한다. listener 누적 방지를 위해 cleanup한다.
  // 앱 복귀 한 번에 focus와 visibilitychange가 함께 오므로 짧은 간격 안의 중복은 한 번으로 묶는다.
  useEffect(() => {
    let lastRevalidateAt = Number.NEGATIVE_INFINITY;
    const revalidate = () => {
      const now = Date.now();
      if (now - lastRevalidateAt < REVALIDATE_COALESCE_MS) return;
      lastRevalidateAt = now;
      setReloadKey((key) => key + 1);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') revalidate();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is an intentional manual-refresh trigger for the error-state retry button
  useEffect(() => {
    if (sessionStatus === 'loading') return;

    const token = session?.user.accessToken;
    if (!token) {
      // usable token 없음을 0건 성공으로 표시하지 않는다. 보호된 stale도 유지하지 않는다.
      // stale-empty가 auth 이후 initial failure로 오분류되지 않도록 성공 기록도 초기화한다.
      requestIdRef.current += 1;
      listScopeRef.current = '__no_token__';
      hasSuccessfulReadRef.current = false;
      setHasSuccessfulRead(false);
      setPreparing([]);
      setDelivering([]);
      setCompletedToday(null);
      resetBatch();
      setAuthRequired(true);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const nextScope = buildDriverListScope({
      userId: session?.user.id,
      role: session?.user.role,
      token,
    });
    if (listScopeRef.current !== nextScope) {
      // user/token scope 변경: 새 fetch 완료를 기다리지 않고 이전 scope의
      // protected rows·성공 기록·error/freshness를 동기적으로 제거한다.
      // 진행 중이던 이전 scope read는 sequence 무효화로 덮어쓰기를 막는다.
      requestIdRef.current += 1;
      listScopeRef.current = nextScope;
      hasSuccessfulReadRef.current = false;
      setHasSuccessfulRead(false);
      setPreparing([]);
      setDelivering([]);
      setCompletedToday(null);
      // 이전 scope에서 고른 주문·진행 중 한 번에 수거도 새 scope로 넘기지 않는다.
      resetBatch();
      setError(null);
      setAuthRequired(false);
      setLoading(true);
      setRefreshing(false);
    }

    const controller = new AbortController();
    let active = true;
    // Abort에만 의존하지 않는 stale-wins 방어: 오래된 응답이 최신 요청을 덮지 못한다.
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const isCurrent = () => active && requestId === requestIdRef.current;
    // 성공한 0건도 성공한 조회다. 이전 성공이 있으면 기존 list를 유지하고 background로 갱신한다.
    const background = hasSuccessfulReadRef.current;
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setAuthRequired(false);
    setError(null);

    apiRead('/driver/orders', token, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw toDriverListReadError(response.status);
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error('driver orders response is not a list');
        return payload as DriverListOrder[];
      })
      .then((orders) => {
        if (!isCurrent()) return;
        setPreparing(orders.filter((order) => order.status === 'PREPARING'));
        setDelivering(
          orders.filter(
            (order) => order.status === 'DELIVERING' || order.status === 'DELIVERY_HELD',
          ),
        );
        hasSuccessfulReadRef.current = true;
        setHasSuccessfulRead(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!isCurrent() || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        const kind = toDriverListReadErrorKind(cause);
        if (kind === 'AUTH_ERROR') {
          // authority loss(401·403): 이전 protected rows를 즉시 제거하고
          // auth-required로 전환한다. 일반 retry loop가 권한 복구 없이
          // stale data를 유지하지 않는다.
          hasSuccessfulReadRef.current = false;
          setHasSuccessfulRead(false);
          setPreparing([]);
          setDelivering([]);
          setCompletedToday(null);
          resetBatch();
          setAuthRequired(true);
          setError(null);
          return;
        }
        if (shouldPreserveDriverListOnReadError(kind, hasSuccessfulReadRef.current)) {
          // refresh 실패는 마지막 정상 데이터를 지우지 않고 stale로 유지한다.
          setError('최신 주문을 불러오지 못했어요. 기존 목록을 보여드려요.');
        } else {
          setPreparing([]);
          setDelivering([]);
          setError('주문을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
        }
      })
      .finally(() => {
        if (!isCurrent()) return;
        setLoading(false);
        setRefreshing(false);
      });

    // 오늘 완료 수: 목록과 같은 조회 경로·scope 가드·재조회 시점이다. 실패하거나 필드가 없으면 그 부분만 숨긴다.
    apiRead('/driver/summary', token, { signal: controller.signal })
      .then(async (response) =>
        response.ok ? readDriverSummaryCompletedToday(await response.json()) : null,
      )
      .catch(() => null)
      .then((value) => {
        if (!isCurrent()) return;
        setCompletedToday(value);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [session?.user.id, session?.user.role, session?.user.accessToken, sessionStatus, reloadKey]);

  const orders = tab === 'preparing' ? preparing : delivering;
  const retry = () => setReloadKey((key) => key + 1);
  const showProgress = hasSuccessfulRead && !authRequired;

  // 한 번에 수거: 내 수거 중 회차 직배송이고 배송 시작이 허용되고 storeId가 있는 주문만 고를 수 있다.
  // 목록이 최신이 아니면(조회 실패로 이전 목록 표시 중·다시 읽는 중) 보내지 않는다(상세 commandsAllowed와 같은 fail-closed).
  const batchCandidates = preparing.filter(isBatchPickupSelectable);
  const selectedOrders = batchCandidates.filter((order) => selectedIds.has(order.id));
  const batchListFresh =
    hasSuccessfulRead && !authRequired && error === null && !loading && !refreshing;
  const batchEntryVisible =
    tab === 'preparing' && !batchMode && batchCandidates.length >= 2 && batchListFresh;
  const batchBarVisible = batchMode && tab === 'preparing' && !authRequired;
  const batchConfirmVisible =
    batchConfirmOpen && batchMode && selectedOrders.length > 0 && batchListFresh && !batchRunning;
  // 조회로 고른 주문이 빠지거나 목록 신뢰도가 떨어지면 창을 닫고 버린다(다시 조건이 맞아도 저절로 뜨지 않게).
  if (batchConfirmOpen && !batchConfirmVisible) setBatchConfirmOpen(false);
  const batchConfirmContent = batchConfirmVisible
    ? buildBatchPickupConfirmContent(selectedOrders)
    : null;
  const batchSelection: BatchSelection | null =
    batchMode && tab === 'preparing'
      ? {
          selectedIds,
          disabled: batchRunning,
          onToggle: (orderId) =>
            setSelectedIds((current) => {
              const next = new Set(current);
              if (next.has(orderId)) next.delete(orderId);
              else next.add(orderId);
              return next;
            }),
        }
      : null;

  async function startBatchPickup(targets: DriverListOrder[]) {
    // 실행 중이면 두 번째 실행을 시작하지 않는다(ref 가드).
    if (batchInFlightRef.current) return;
    const token = session?.user.accessToken;
    if (!token || targets.length === 0 || !batchListFresh) return;
    batchSeqRef.current += 1;
    const seq = batchSeqRef.current;
    const startScope = liveListScopeRef.current;
    // 화면을 떠났거나 세션 scope가 바뀌었거나 더 새 실행·초기화가 있으면 남은 요청을 보내지 않고 화면에 쓰지 않는다.
    const batchStillCurrent = () =>
      mountedRef.current && seq === batchSeqRef.current && liveListScopeRef.current === startScope;
    batchInFlightRef.current = true;
    setBatchConfirmOpen(false);
    setBatchSummary(null);
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: targets.length });
    try {
      // 주문마다 기존 상태 변경을 하나씩 차례로 보낸다. 같은 요청은 자동으로 다시 보내지 않는다.
      const run = await runBatchPickup({
        orders: targets,
        isCurrent: batchStillCurrent,
        send: (order) =>
          apiFetch(
            `/stores/${apiPathSegment(order.storeId)}/orders/${apiPathSegment(order.id)}/status`,
            token,
            { method: 'PATCH', body: JSON.stringify({ status: BATCH_PICKUP_TARGET_STATUS }) },
          ),
        onProgress: (done) => {
          if (batchStillCurrent()) setBatchProgress({ done, total: targets.length });
        },
      });
      if (!batchStillCurrent()) return;
      if (run.stoppedBy === 'AUTH_LOST') {
        // 인증 상실: 남은 주문은 보내지 않았다. 목록 조회의 401·403과 같이 보호 목록을 지우고 인증 오류 화면으로 간다.
        // 진행 중인 목록 조회가 지운 목록을 다시 채우지 않도록 조회 순번도 무효화한다.
        requestIdRef.current += 1;
        hasSuccessfulReadRef.current = false;
        setHasSuccessfulRead(false);
        setPreparing([]);
        setDelivering([]);
        setCompletedToday(null);
        setBatchMode(false);
        setSelectedIds(new Set());
        setAuthRequired(true);
        setError(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setBatchSummary(summarizeBatchPickup(run.results));
      setBatchMode(false);
      setSelectedIds(new Set());
      // 결과는 목록을 다시 읽어 확인한다(시작한 주문은 배송 중 탭으로 옮겨 간다).
      retry();
    } finally {
      if (seq === batchSeqRef.current) {
        batchInFlightRef.current = false;
        setBatchRunning(false);
        setBatchProgress(null);
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* 머리: 로고 + 제목 한 줄, 배송지 점 띠와 진행 한 줄, 탭(design-direction.md §6). 틀은 흰 바탕·검정 글자다.
          목록은 날짜·회차와 관계없이 기사에게 보이는 주문을 모두 보여 주므로 제목에 오늘 날짜를 쓰지 않고,
          오늘이 아닌 회차 주문은 행에 배송일을 쓴다(OrderCard). */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg)',
          padding: '12px 16px 0',
        }}
      >
        <div className="flex min-h-11 items-center gap-3">
          <span
            aria-hidden="true"
            style={{
              fontFamily: 'var(--font-brand)',
              fontWeight: 'var(--fw-extrabold)',
              fontSize: 'var(--font-size-lg)',
              color: 'var(--color-primary-dark)',
              lineHeight: 1,
            }}
          >
            Green Love
          </span>
          <h1
            className="m-0"
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-text)',
              lineHeight: 1.4,
            }}
          >
            배송 목록
          </h1>
        </div>
        {showProgress && (
          <DeliveryProgress
            preparing={preparing}
            delivering={delivering}
            completedToday={completedToday}
          />
        )}

        {/* 탭: 선택 표시는 색 없이 검정 3px 밑줄과 굵은 검정 글자다. */}
        <div className="mt-2 flex">
          {[
            { key: 'preparing', label: '수거 대기', count: preparing.length },
            { key: 'delivering', label: '배송 중', count: delivering.length },
          ].map(({ key, label, count }) => (
            <button
              type="button"
              key={key}
              aria-pressed={tab === key}
              className="flex min-h-12 flex-1 cursor-pointer appearance-none items-center justify-center border-0 bg-transparent p-0 text-inherit no-underline"
              onClick={() => router.replace(`/board?tab=${key}`)}
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: tab === key ? 'var(--fw-bold)' : 'var(--fw-regular)',
                borderBottom: `3px solid ${tab === key ? 'var(--color-text)' : 'transparent'}`,
                color: tab === key ? 'var(--color-text)' : 'var(--driver-text-muted)',
              }}
            >
              {label}
              {count > 0 && (
                <span className="ml-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* 주문 목록 */}
      <main style={{ flex: 1, padding: '16px' }}>
        {batchSummary && !authRequired && (
          <BatchSummaryPanel summary={batchSummary} onClose={() => setBatchSummary(null)} />
        )}
        {/* 고르기 모드 안내와 취소는 목록 상태(이전 목록 표시 중·빈 목록 포함)와 관계없이 늘 보여 모드에 갇히지 않게 한다. */}
        {batchBarVisible && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className={text} style={messageStyle}>
              배송을 시작할 내 수거 주문을 골라 주세요.
            </p>
            <TextButton
              disabled={batchRunning}
              onClick={() => {
                setBatchMode(false);
                setSelectedIds(new Set());
                setBatchConfirmOpen(false);
              }}
            >
              고르기 취소
            </TextButton>
          </div>
        )}
        {loading ? (
          <BoardMessage>주문을 불러오고 있어요</BoardMessage>
        ) : authRequired ? (
          <BoardMessage tone="danger" message="로그인이 끝났어요. 다시 로그인해 주세요.">
            {/* 인증 오류는 같은 토큰으로 재조회해도 반복되므로 재조회 버튼 없이 세션을 정리하고 로그인으로 보낸다. */}
            <AppButton onClick={() => void signOut({ redirectTo: '/login' })}>
              다시 로그인
            </AppButton>
          </BoardMessage>
        ) : error && !hasSuccessfulRead ? (
          <BoardMessage tone="danger" message={error}>
            <AppButton tone="brand-outline" onClick={retry}>
              다시 시도
            </AppButton>
          </BoardMessage>
        ) : error && hasSuccessfulRead ? (
          orders.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2.5">
              <p className={text} style={{ ...messageStyle, color: 'var(--color-danger)' }}>
                {error}
              </p>
              <p className={text} style={messageStyle}>
                {tab === 'preparing'
                  ? '마지막 확인 당시 수거할 주문이 없었어요.'
                  : '마지막 확인 당시 배송 중인 주문이 없었어요.'}
              </p>
              <AppButton tone="brand-outline" onClick={() => setReloadKey((key) => key + 1)}>
                다시 시도
              </AppButton>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {refreshing && (
                <p className={text} style={messageStyle}>
                  최신 정보를 확인하고 있어요…
                </p>
              )}
              <div className="flex flex-col items-center justify-center gap-2.5">
                <p className={text} style={{ ...messageStyle, color: 'var(--color-danger)' }}>
                  {error} (이전 목록 표시 중)
                </p>
                <AppButton tone="brand-outline" onClick={retry}>
                  다시 시도
                </AppButton>
              </div>
              <OrderList key={tab} orders={orders} tab={tab} batch={batchSelection} />
            </div>
          )
        ) : refreshing && hasSuccessfulRead && orders.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2.5">
            <p className={text} style={messageStyle}>
              최신 정보를 확인하고 있어요…
            </p>
            <p className={text} style={messageStyle}>
              {tab === 'preparing'
                ? '마지막 확인 당시 수거할 주문이 없었어요.'
                : '마지막 확인 당시 배송 중인 주문이 없었어요.'}
            </p>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2.5">
            <p className={text} style={messageStyle}>
              {tab === 'preparing' ? '수거할 주문이 없어요' : '배송 중인 주문이 없어요'}
            </p>
            {tab === 'preparing' && (
              <button
                type="button"
                className="m-0 inline min-h-11 cursor-pointer appearance-none border-0 bg-transparent p-0 underline"
                style={{
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text)',
                }}
                onClick={() => router.push('/map')}
              >
                지도에서 경로 보기
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {refreshing && (
              <p className={text} style={messageStyle}>
                최신 정보를 확인하고 있어요…
              </p>
            )}
            {error && (
              <div className="flex flex-col items-center justify-center gap-2.5">
                <p className={text} style={{ ...messageStyle, color: 'var(--color-danger)' }}>
                  {error} (이전 목록 표시 중)
                </p>
                <AppButton tone="brand-outline" onClick={retry}>
                  다시 시도
                </AppButton>
              </div>
            )}
            {batchEntryVisible && (
              <TextButton
                onClick={() => {
                  setBatchSummary(null);
                  setSelectedIds(new Set());
                  setBatchMode(true);
                }}
              >
                여러 주문 한 번에 배송 시작
              </TextButton>
            )}
            <OrderList key={tab} orders={orders} tab={tab} batch={batchSelection} />
          </div>
        )}
      </main>

      {/* 한 번에 수거: 고른 주문 수를 이름에 쓴 주요 버튼 하나를 하단 바 위에 고정한다(상세 주요 버튼과 같은 자리·크기). */}
      {batchBarVisible && (
        <div
          style={{
            position: 'sticky',
            bottom: 'calc(72px + env(safe-area-inset-bottom))',
            padding: '12px 16px',
            backgroundColor: 'var(--color-bg)',
            boxShadow: 'var(--driver-bar-shadow)',
          }}
        >
          <AppButton
            fullWidth
            size="xl"
            loading={batchRunning}
            disabled={batchRunning || selectedOrders.length === 0 || !batchListFresh}
            onClick={() => {
              if (batchInFlightRef.current) return;
              setBatchConfirmOpen(true);
            }}
          >
            {batchRunning && batchProgress
              ? `배송 시작하는 중 ${batchProgress.done}/${batchProgress.total}`
              : selectedOrders.length > 0
                ? `${selectedOrders.length}곳 배송 시작`
                : '주문을 골라 주세요'}
          </AppButton>
        </div>
      )}

      <BatchPickupConfirmDialog
        opened={batchConfirmVisible}
        content={batchConfirmContent}
        confirmDisabled={batchRunning || !batchListFresh}
        onClose={() => setBatchConfirmOpen(false)}
        onConfirm={() => {
          // 확인한 순간 고른 주문(목록 순서)으로 실행한다. 이후 조회가 바꾼 목록은 이 실행에 섞이지 않는다.
          void startBatchPickup(selectedOrders);
        }}
      />
    </div>
  );
}

function TextButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="m-0 min-h-11 shrink-0 cursor-pointer appearance-none self-start border-0 bg-transparent p-0 underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        fontSize: 'var(--font-size-md)',
        fontWeight: 'var(--fw-bold)',
        color: 'var(--color-text)',
      }}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 한 번에 수거 결과 요약. 시작·이미 바뀜·확인 필요 수를 보이고 닫을 수 있다. */
function BatchSummaryPanel({
  summary,
  onClose,
}: {
  summary: BatchPickupSummary;
  onClose: () => void;
}) {
  const { line, notes } = buildBatchPickupSummaryText(summary);
  const problem = summary.alreadyChanged > 0 || summary.needsCheck > 0;
  return (
    <section
      aria-label="한 번에 배송 시작 결과"
      className="mb-3 flex flex-col gap-1.5 rounded-[var(--radius)] p-4"
      style={{
        // 문제 결과가 있으면 빨강 연한 면 + 검정 글자(상세 문제 면과 같다), 아니면 연회색 면.
        backgroundColor: problem ? 'var(--color-danger-surface)' : 'var(--color-surface-muted)',
      }}
    >
      <p
        className={text}
        style={{
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {line}
      </p>
      {notes.map((note) => (
        <p key={note} className={text} style={{ ...messageStyle, color: 'var(--color-text)' }}>
          {note}
        </p>
      ))}
      <TextButton onClick={onClose}>닫기</TextButton>
    </section>
  );
}

const messageStyle = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--driver-text-muted)',
} as const;

function BoardMessage({
  children,
  message,
  tone,
}: {
  children: ReactNode;
  message?: string;
  tone?: 'danger';
}) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-2.5">
      {message ? (
        <>
          <p
            className={text}
            style={{
              ...messageStyle,
              color: tone === 'danger' ? 'var(--color-danger)' : messageStyle.color,
            }}
          >
            {message}
          </p>
          {children}
        </>
      ) : (
        <p className={text} style={messageStyle}>
          {children}
        </p>
      )}
    </div>
  );
}

/** 첫 화면에 보이는 행 수. 넘치면 "남은 n곳 더 보기"로 남은 수를 밝힌다(design-direction.md §6). */
const FIRST_SCREEN_ROWS = 5;

function OrderList({
  orders,
  tab,
  batch = null,
}: {
  orders: DriverListOrder[];
  tab: string;
  /** 한 번에 수거 고르기 모드. 내 수거 행에만 고르기 칸을 둔다. */
  batch?: BatchSelection | null;
}) {
  const [expanded, setExpanded] = useState(false);
  // 수거 대기 탭은 내게 배정된 주문과 아직 아무도 맡지 않은 주문을 나눠 보인다.
  // 배정 여부가 없는 이전 API 응답이면 groupPreparingOrders가 null을 돌려 예전처럼 한 묶음이다.
  const groups = tab === 'preparing' ? groupPreparingOrders(orders) : null;
  if (groups) {
    // 두 묶음을 합쳐 첫 화면 5행이다. 내 수거가 먼저 채우고, 더 보기는 가려진 전체 수를 보인다.
    // 고르기 모드에서는 내 수거를 모두 보여 가려진 주문을 고르지 못하는 일이 없게 한다.
    const shown = expanded
      ? { mine: groups.mine, available: groups.available, hidden: 0 }
      : takePreparingFirstScreen(
          groups,
          batch ? Math.max(FIRST_SCREEN_ROWS, groups.mine.length) : FIRST_SCREEN_ROWS,
        );
    return (
      <>
        {shown.mine.length > 0 && (
          <OrderGroup
            title="내 수거"
            total={groups.mine.length}
            orders={shown.mine}
            tab={tab}
            batch={batch}
          />
        )}
        {shown.available.length > 0 && (
          <OrderGroup
            title="맡을 수 있는 주문"
            hint="주문을 열어 배송을 시작하면 내 주문이 돼요."
            total={groups.available.length}
            orders={shown.available}
            tab={tab}
          />
        )}
        <ShowMoreButton hidden={shown.hidden} onClick={() => setExpanded(true)} />
      </>
    );
  }

  // 배송 중 탭에서는 보류가 아닌 첫 배송지를 "다음 배송지"로 크게 보인다. 순서는 목록 응답 순서다.
  // 보류 주문이 있으면 "배송할 주문"과 "보류" 묶음으로 나누고, 보류 묶음은 첫 화면 행 수를 따로 센다.
  const delivering = tab === 'delivering' ? groupDeliveringOrders(orders) : null;
  if (delivering) {
    const shown = expanded
      ? { ...delivering, hidden: 0 }
      : takeDeliveringFirstScreen(delivering, FIRST_SCREEN_ROWS);
    const nextCard = shown.next && <OrderCard order={shown.next} tab={tab} variant="next" />;
    const toDeliverTotal = delivering.rest.length + (delivering.next ? 1 : 0);
    return (
      <>
        {delivering.held.length > 0 ? (
          <>
            {toDeliverTotal > 0 && (
              <OrderGroup
                title="배송할 주문"
                total={toDeliverTotal}
                orders={shown.rest}
                tab={tab}
                lead={nextCard}
              />
            )}
            <OrderGroup title="보류" total={delivering.held.length} orders={shown.held} tab={tab} />
          </>
        ) : (
          <>
            {nextCard}
            <OrderRows orders={shown.rest} tab={tab} />
          </>
        )}
        <ShowMoreButton hidden={shown.hidden} onClick={() => setExpanded(true)} />
      </>
    );
  }

  return (
    <>
      <OrderRows orders={expanded ? orders : orders.slice(0, FIRST_SCREEN_ROWS)} tab={tab} />
      <ShowMoreButton
        hidden={expanded ? 0 : Math.max(0, orders.length - FIRST_SCREEN_ROWS)}
        onClick={() => setExpanded(true)}
      />
    </>
  );
}

function OrderGroup({
  title,
  hint,
  lead,
  total,
  orders,
  tab,
  batch = null,
}: {
  title: string;
  hint?: string;
  /** 행 목록 앞에 두는 카드(배송 중 탭의 "다음 배송지"). */
  lead?: ReactNode;
  /** 묶음 전체 행 수. orders는 첫 화면에 보이는 앞부분일 수 있다. */
  total: number;
  orders: DriverListOrder[];
  tab: string;
  batch?: BatchSelection | null;
}) {
  return (
    <section className="flex flex-col gap-1" aria-label={title}>
      <h2
        className="m-0"
        style={{
          fontSize: 'var(--font-size-md)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
          lineHeight: 1.4,
        }}
      >
        {title}
        <span className="ml-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {total}
        </span>
      </h2>
      {hint && (
        <p className={text} style={messageStyle}>
          {hint}
        </p>
      )}
      {lead}
      <OrderRows orders={orders} tab={tab} batch={batch} />
    </section>
  );
}

/** 한 번에 수거 고르기 칸. 고를 수 없는 내 수거 주문은 꺼진 칸과 까닭을 보인다. */
function toRowSelection(order: DriverListOrder, batch: BatchSelection): OrderRowSelection {
  const reason = batchPickupBlockReason(order);
  return {
    checked: reason === null && batch.selectedIds.has(order.id),
    disabled: batch.disabled || reason !== null,
    onToggle: () => {
      if (reason === null) batch.onToggle(order.id);
    },
    note: batchPickupBlockLabel(reason),
  };
}

function OrderRows({
  orders,
  tab,
  batch = null,
}: {
  orders: DriverListOrder[];
  tab: string;
  batch?: BatchSelection | null;
}) {
  if (orders.length === 0) return null;
  return (
    <ul className="m-0 list-none p-0">
      {orders.map((order, index) => (
        <li key={order.id} style={index === 0 ? undefined : { borderTop: 'var(--border)' }}>
          <OrderCard
            order={order}
            tab={tab}
            selection={batch ? toRowSelection(order, batch) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}

function ShowMoreButton({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button
      type="button"
      className="flex min-h-12 w-full cursor-pointer appearance-none items-center justify-center rounded-[var(--radius)] border-0 p-0"
      style={{
        backgroundColor: 'var(--color-surface-muted)',
        color: 'var(--color-text)',
        fontSize: 'var(--font-size-md)',
        fontWeight: 'var(--fw-bold)',
      }}
      onClick={onClick}
    >
      남은 {hidden}곳 더 보기
    </button>
  );
}

/**
 * 배송지 점 띠와 진행 한 줄. 목록 API가 주는 값(배송 중·보류·수거 대기 주문)만으로 그린다.
 * 숫자 기준: 점 띠와 진행 줄은 "내 주문"(배송 중·보류·내 수거)을 세고, 아무도 맡지 않은 주문은 점 띠에 그리지 않고
 * 진행 줄의 "맡을 수 있는 n곳"으로만 센다. 탭 숫자는 탭의 전체 행 수(내 수거 + 맡을 수 있는 주문)다.
 * 줄 끝의 "오늘 완료 n곳"은 목록이 아니라 기사 요약(GET /driver/summary)의 값이고, 읽지 못하면 그 부분만 숨긴다.
 * 1곳 이상이면 오늘 완료 내역(/board/completed)으로 가는 링크다.
 * 도착 예상 시간은 기사 API에 없어 쓰지 않는다(design-direction.md §3.5).
 */
function DeliveryProgress({
  preparing,
  delivering,
  completedToday,
}: {
  preparing: DriverListOrder[];
  delivering: DriverListOrder[];
  completedToday: number | null;
}) {
  const held = delivering.filter((order) => order.status === 'DELIVERY_HELD').length;
  const toDeliver = delivering.length - held;
  // 배정 여부를 알면 수거는 내 주문만 세고, 아무도 맡지 않은 주문은 따로 센다.
  const preparingGroups = groupPreparingOrders(preparing);
  // 점 띠에는 내 수거만 그린다. 배정 여부를 모르는 이전 응답이면 예전처럼 수거 대기 전체를 그린다.
  const myPreparing = preparingGroups ? preparingGroups.mine : preparing;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {myPreparing.length + delivering.length > 0 && (
        <div aria-hidden="true" className="flex flex-wrap gap-1.5">
          {delivering.map((order) => (
            <span
              key={order.id}
              className="block size-2.5 rounded-full"
              style={{
                backgroundColor:
                  order.status === 'DELIVERY_HELD' ? 'var(--color-danger)' : 'var(--color-text)',
              }}
            />
          ))}
          {myPreparing.map((order) => (
            <span
              key={order.id}
              className="block size-2.5 rounded-full"
              style={{ boxShadow: 'inset 0 0 0 2px var(--driver-text-muted)' }}
            />
          ))}
        </div>
      )}
      <p
        className={text}
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--driver-text-muted)',
          fontVariantNumeric: 'tabular-nums',
          // 항목이 늘어 두 줄이 될 때 "오늘 / 완료"처럼 낱말 중간에서 끊기지 않게 낱말 단위로 줄을 바꾼다.
          wordBreak: 'keep-all',
        }}
      >
        남은 배송 {toDeliver}곳
        {held > 0 && (
          <>
            {' · '}
            <span style={{ color: 'var(--color-danger)', fontWeight: 'var(--fw-bold)' }}>
              보류 {held}곳
            </span>
          </>
        )}
        {' · '}수거 {myPreparing.length}곳
        {preparingGroups && preparingGroups.available.length > 0 && (
          <>
            {' · '}맡을 수 있는 {preparingGroups.available.length}곳
          </>
        )}
        {completedToday !== null && completedToday > 0 && (
          <>
            {' · '}
            {/* 손님 문의에 답할 때 오늘 마친 배송·사진을 다시 보는 화면으로 간다. 0곳이면 볼 것이 없어 글자만 둔다. */}
            <Link
              href="/board/completed"
              prefetch={false}
              // 글줄 높이는 그대로 두고 위아래 여백으로 누를 자리만 넓힌다(인라인 요소의 세로 여백은 줄을 밀지 않는다).
              className="py-2 underline underline-offset-4"
              style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}
            >
              오늘 완료 {completedToday}곳
            </Link>
          </>
        )}
        {completedToday === 0 && <>{' · '}오늘 완료 0곳</>}
      </p>
    </div>
  );
}
