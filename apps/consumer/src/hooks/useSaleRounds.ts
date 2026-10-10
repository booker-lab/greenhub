'use client';

import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API_URL = getApiBaseUrl();

export type PublicSaleRound = SaleRound & { items: SaleRoundItem[] };
export type SaleRoundsRequestStatus =
  | 'loading'
  | 'error'
  | 'empty'
  | 'success'
  | 'refreshing'
  | 'stale';

export interface SaleRoundsState {
  rounds: PublicSaleRound[];
  currentRound: PublicSaleRound | null;
  pastRounds: PublicSaleRound[];
  status: SaleRoundsRequestStatus;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  isRefreshing: boolean;
  isStale: boolean;
}

export interface UseSaleRoundsResult extends SaleRoundsState {
  refetch: () => void;
}

type FetchPublicSaleRounds = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function emptyData() {
  return {
    rounds: [],
    currentRound: null,
    pastRounds: [],
  } satisfies Pick<SaleRoundsState, 'rounds' | 'currentRound' | 'pastRounds'>;
}

export function createLoadingSaleRoundsState(): SaleRoundsState {
  return {
    ...emptyData(),
    status: 'loading',
    loading: true,
    error: null,
    isEmpty: false,
    isRefreshing: false,
    isStale: false,
  };
}

export function createEmptySaleRoundsState(): SaleRoundsState {
  return {
    ...emptyData(),
    status: 'empty',
    loading: false,
    error: null,
    isEmpty: true,
    isRefreshing: false,
    isStale: false,
  };
}

export function createErrorSaleRoundsState(error: unknown): SaleRoundsState {
  return {
    ...emptyData(),
    status: 'error',
    loading: false,
    error: error instanceof Error ? error.message : '회차 조회에 실패했습니다.',
    isEmpty: false,
    isRefreshing: false,
    isStale: false,
  };
}

function dateMillis(round: SaleRound) {
  const value = new Date(round.schedule.orderOpenAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function sortLatestFirst(rounds: PublicSaleRound[]) {
  return [...rounds].sort((a, b) => dateMillis(b) - dateMillis(a));
}

function selectCurrentRound(rounds: PublicSaleRound[], now: Date) {
  const openRound = rounds.find((round) => round.status === 'OPEN');
  if (openRound) return openRound;

  const nowMillis = now.getTime();
  const scheduledRound = rounds
    .filter((round) => round.status === 'SCHEDULED' && dateMillis(round) > nowMillis)
    .sort((a, b) => dateMillis(a) - dateMillis(b))[0];
  if (scheduledRound) return scheduledRound;

  return rounds.find((round) => round.status === 'CLOSED') ?? null;
}

function createSuccessSaleRoundsState(rounds: PublicSaleRound[], now: Date): SaleRoundsState {
  const sortedRounds = sortLatestFirst(rounds);
  const currentRound = selectCurrentRound(sortedRounds, now);
  const pastRounds = sortedRounds.filter(
    (round) =>
      round.id !== currentRound?.id && (round.status === 'CLOSED' || round.status === 'COMPLETED'),
  );

  return {
    rounds: sortedRounds,
    currentRound,
    pastRounds,
    status: 'success',
    loading: false,
    error: null,
    isEmpty: false,
    isRefreshing: false,
    isStale: false,
  };
}

function readErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof Error) return error.message;
  return '회차 조회에 실패했습니다.';
}

export function hasRecoverableSaleRoundsData(state: SaleRoundsState): boolean {
  return state.rounds.length > 0;
}

export function createRefreshingSaleRoundsState(previous: SaleRoundsState): SaleRoundsState {
  return {
    rounds: previous.rounds,
    currentRound: previous.currentRound,
    pastRounds: previous.pastRounds,
    status: 'refreshing',
    loading: false,
    error: null,
    isEmpty: false,
    isRefreshing: true,
    isStale: false,
  };
}

export function createStaleSaleRoundsState(
  previous: SaleRoundsState,
  error: unknown,
): SaleRoundsState {
  return {
    rounds: previous.rounds,
    currentRound: previous.currentRound,
    pastRounds: previous.pastRounds,
    status: 'stale',
    loading: false,
    error: readErrorMessage(error),
    isEmpty: false,
    isRefreshing: false,
    isStale: true,
  };
}

export function resolveSaleRoundsRefreshStart(previous: SaleRoundsState): SaleRoundsState {
  if (hasRecoverableSaleRoundsData(previous)) {
    return createRefreshingSaleRoundsState(previous);
  }
  return createLoadingSaleRoundsState();
}

export function resolveSaleRoundsRefreshResult(
  previous: SaleRoundsState,
  next: SaleRoundsState,
): SaleRoundsState {
  if (next.status === 'error' && hasRecoverableSaleRoundsData(previous)) {
    return createStaleSaleRoundsState(previous, next.error);
  }
  return next;
}

function readRoundSummaries(payload: unknown): SaleRound[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('items' in payload) ||
    !Array.isArray(payload.items)
  ) {
    throw new Error('회차 목록 응답 형식이 올바르지 않습니다.');
  }
  return payload.items as SaleRound[];
}

function readRoundDetail(payload: unknown): PublicSaleRound {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('id' in payload) ||
    !('items' in payload) ||
    !Array.isArray(payload.items)
  ) {
    throw new Error('회차 상세 응답 형식이 올바르지 않습니다.');
  }
  return payload as PublicSaleRound;
}

export async function fetchPublicSaleRoundsState(
  storeId: string,
  fetcher: FetchPublicSaleRounds = fetch,
  now: Date = new Date(),
): Promise<SaleRoundsState> {
  const publicRoundsUrl = `${API_URL}/stores/${encodeURIComponent(storeId)}/sale-rounds/public`;

  try {
    const listResponse = await fetcher(publicRoundsUrl);
    if (!listResponse.ok) {
      throw new Error(`회차 조회 오류: ${listResponse.status}`);
    }

    const summaries = readRoundSummaries(await listResponse.json());
    if (summaries.length === 0) return createEmptySaleRoundsState();

    const rounds = await Promise.all(
      summaries.map(async (round) => {
        const detailResponse = await fetcher(`${publicRoundsUrl}/${encodeURIComponent(round.id)}`);
        if (!detailResponse.ok) {
          throw new Error(`회차 상세 조회 오류: ${detailResponse.status}`);
        }
        return readRoundDetail(await detailResponse.json());
      }),
    );

    return createSuccessSaleRoundsState(rounds, now);
  } catch (error: unknown) {
    return createErrorSaleRoundsState(error);
  }
}

const ROUND_BOUNDARY_REFETCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const ROUND_BOUNDARY_GRACE_MS = 1000;
const ROUND_BOUNDARY_JITTER_MS = 3000;
const ROUND_BOUNDARY_LATE_RETRY_MS = 5000;
const ROUND_BOUNDARY_LATE_WINDOW_MS = 60 * 1000;

/** 회차 상태가 시간으로 바뀌는 시각: 판매 예정은 주문 시작, 판매 중은 주문 마감. 없으면 null. */
function roundBoundaryMillis(round: Pick<SaleRound, 'status' | 'schedule'>): number | null {
  const at =
    round.status === 'SCHEDULED'
      ? round.schedule?.orderOpenAt
      : round.status === 'OPEN'
        ? round.schedule?.orderCloseAt
        : null;
  const millis = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  return Number.isFinite(millis) ? millis : null;
}

/**
 * 주문 시작·마감이 지나면 새로고침 없이 상태가 바뀌도록 다시 조회할 지연(ms). 필요 없으면 null.
 * - 경계 전에 받은 정보: 경계 1초 뒤에 0~3초를 흩뿌려 다시 조회한다(열린 탭이 같은 순간에 몰리지 않게).
 *   24시간보다 먼 경계는 예약하지 않는다(다시 들어오거나 화면에 돌아올 때 다시 계산).
 * - 경계 뒤에 받았는데 아직 이전 상태(기기 시계가 서버보다 빠름): 경계 뒤 1분 안에서만 5초 간격으로 다시 확인한다.
 */
export function roundBoundaryRefetchDelay(
  rounds: ReadonlyArray<Pick<SaleRound, 'status' | 'schedule'>>,
  nowMillis: number,
  lastFetchStartedAt: number,
  random: () => number = Math.random,
): number | null {
  if (!Number.isFinite(nowMillis)) return null;
  let wait: number | null = null;
  for (const round of rounds) {
    const boundary = roundBoundaryMillis(round);
    if (boundary === null) continue;
    const untilBoundary = boundary - nowMillis;
    let candidate: number | null = null;
    if (untilBoundary > 0) {
      if (untilBoundary <= ROUND_BOUNDARY_REFETCH_WINDOW_MS) {
        candidate = untilBoundary + ROUND_BOUNDARY_GRACE_MS;
      }
    } else if (!(lastFetchStartedAt >= boundary)) {
      candidate = ROUND_BOUNDARY_GRACE_MS;
    } else if (-untilBoundary < ROUND_BOUNDARY_LATE_WINDOW_MS) {
      candidate = ROUND_BOUNDARY_LATE_RETRY_MS;
    }
    if (candidate !== null && (wait === null || candidate < wait)) wait = candidate;
  }
  if (wait === null) return null;
  const spread = Math.min(Math.max(random(), 0), 1) * ROUND_BOUNDARY_JITTER_MS;
  return Math.floor(wait + spread);
}

export function useSaleRounds(storeId: string | null): UseSaleRoundsResult {
  const [state, setState] = useState<SaleRoundsState>(createLoadingSaleRoundsState);
  const [visibilityTick, setVisibilityTick] = useState(0);
  const requestId = useRef(0);
  const scopeRef = useRef<string | null>(storeId);
  const lastFetchStartedAt = useRef(Number.NaN);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const target = storeId;
    scopeRef.current = target;
    const currentRequestId = ++requestId.current;
    if (!target) {
      setState(createEmptySaleRoundsState());
      return () => {
        requestId.current += 1;
      };
    }

    // Scope 진입은 이전 scope 잔재를 무효화한다: 빈 loading으로 리셋한다.
    setState(createLoadingSaleRoundsState());
    lastFetchStartedAt.current = Date.now();
    void (async () => {
      const nextState = await fetchPublicSaleRoundsState(target);
      if (requestId.current === currentRequestId && scopeRef.current === target) {
        setState(nextState);
      }
    })();
    return () => {
      requestId.current += 1;
    };
  }, [storeId]);

  const refetch = useCallback(() => {
    const target = storeId;
    if (!target) {
      scopeRef.current = target;
      ++requestId.current;
      setState(createEmptySaleRoundsState());
      return;
    }

    // 동일 scope refresh는 이전 성공 데이터를 보존한다.
    // scope가 바뀌는 동안의 호출은 loading으로 리셋해 이전 store 노출을 막는다.
    const snapshot = stateRef.current;
    const canRecover =
      scopeRef.current === target && hasRecoverableSaleRoundsData(snapshot);
    const currentRequestId = ++requestId.current;
    setState(
      canRecover
        ? createRefreshingSaleRoundsState(snapshot)
        : createLoadingSaleRoundsState(),
    );
    lastFetchStartedAt.current = Date.now();
    void (async () => {
      const nextState = await fetchPublicSaleRoundsState(target);
      if (requestId.current !== currentRequestId || scopeRef.current !== target) return;
      if (nextState.status === 'error' && canRecover) {
        setState(createStaleSaleRoundsState(snapshot, nextState.error));
        return;
      }
      setState(nextState);
    })();
  }, [storeId]);

  // 화면에 돌아오면(탭 전환·앱 복귀) 경계 계산을 다시 한다. 숨어 있는 동안 지난 경계는 바로 다시 조회한다.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') setVisibilityTick((tick) => tick + 1);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // 표시 중인 회차의 주문 시작·마감 직후 다시 조회해 새로고침 없이 판매 상태를 바꾼다.
  useEffect(() => {
    // visibilityTick은 화면 복귀 때 이 계산을 다시 하게 하는 의도적인 트리거다.
    void visibilityTick;
    if (state.status === 'loading' || state.status === 'refreshing') return;
    const delay = roundBoundaryRefetchDelay(state.rounds, Date.now(), lastFetchStartedAt.current);
    if (delay === null) return;
    const timer = setTimeout(() => {
      // 숨은 탭은 경계 순간에 부르지 않고 화면에 돌아올 때 위 복귀 계산으로 다시 조회한다.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refetch();
    }, delay);
    return () => clearTimeout(timer);
  }, [state, visibilityTick, refetch]);

  return { ...state, refetch };
}
