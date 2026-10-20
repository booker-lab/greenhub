'use client';

import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { sharedRequest } from '@/lib/shared-request';

const API_URL = getApiBaseUrl();

/** 홈·카테고리에 보이는 지난 회차(마감·완료) 개수. 회차가 쌓여도 화면과 응답이 커지지 않게 한다. */
export const PAST_ROUND_DISPLAY_LIMIT = 2;
/**
 * 서버에서 받는 지난 회차 개수. 판매 중·예정 회차가 없으면 가장 최근 마감 회차가 "지금 회차"가 되므로,
 * 그때도 지난 회차가 PAST_ROUND_DISPLAY_LIMIT개 남도록 하나 더 받는다.
 */
const PAST_ROUND_FETCH_LIMIT = PAST_ROUND_DISPLAY_LIMIT + 1;
/** 홈·상품 상세·장바구니·결제가 같은 매장 회차를 잇달아 부를 때 한 번만 보내도록 공유하는 시간. */
const SALE_ROUNDS_SHARE_TTL_MS = 30_000;

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
  const pastRounds = sortedRounds
    .filter(
      (round) =>
        round.id !== currentRound?.id &&
        (round.status === 'CLOSED' || round.status === 'COMPLETED'),
    )
    .slice(0, PAST_ROUND_DISPLAY_LIMIT);

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

function readRoundsWithItems(payload: unknown): PublicSaleRound[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('items' in payload) ||
    !Array.isArray(payload.items)
  ) {
    throw new Error('회차 목록 응답 형식이 올바르지 않습니다.');
  }
  return payload.items.map(readRoundDetail);
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
  // 판매 중·예정 회차 전부와 최근 지난 회차만 상품까지 한 번에 받는다(회차마다 상세를 따로 부르지 않는다).
  const roundsUrl = `${publicRoundsUrl(storeId)}?include=items&past=${PAST_ROUND_FETCH_LIMIT}`;

  try {
    const response = await fetcher(roundsUrl);
    if (!response.ok) {
      throw new Error(`회차 조회 오류: ${response.status}`);
    }

    const rounds = readRoundsWithItems(await response.json());
    if (rounds.length === 0) return createEmptySaleRoundsState();
    return createSuccessSaleRoundsState(rounds, now);
  } catch (error: unknown) {
    return createErrorSaleRoundsState(error);
  }
}

function publicRoundsUrl(storeId: string) {
  return `${API_URL}/stores/${encodeURIComponent(storeId)}/sale-rounds/public`;
}

/**
 * 같은 매장 회차 조회를 화면 사이에서 잠깐 공유한다(lib/shared-request).
 * 실패는 공유하지 않고, fresh(다시 불러오기·주문 시작/마감 경계 다시 조회)는 공유된 결과를 쓰지 않는다.
 */
export function loadPublicSaleRoundsState(
  storeId: string,
  options: { fresh?: boolean } = {},
): Promise<SaleRoundsState> {
  return sharedRequest(
    `sale-rounds:${storeId}`,
    async () => {
      const state = await fetchPublicSaleRoundsState(storeId);
      if (state.status === 'error') throw new Error(readErrorMessage(state.error));
      return state;
    },
    { ttlMs: SALE_ROUNDS_SHARE_TTL_MS, fresh: options.fresh },
  ).catch((error: unknown) => createErrorSaleRoundsState(error));
}

/** 공개 회차 하나(상품 포함). 없거나 공개되지 않은 회차·읽기 실패는 null. */
export async function fetchPublicSaleRound(
  storeId: string,
  roundId: string,
  fetcher: FetchPublicSaleRounds = fetch,
): Promise<PublicSaleRound | null> {
  try {
    const response = await fetcher(`${publicRoundsUrl(storeId)}/${encodeURIComponent(roundId)}`);
    if (!response.ok) return null;
    const round = readRoundDetail(await response.json());
    return round.id === roundId && round.storeId === storeId ? round : null;
  } catch {
    return null;
  }
}

export type PublicSaleRoundLookup =
  | { status: 'idle' | 'loading' | 'missing'; round: null }
  | { status: 'ready'; round: PublicSaleRound };

/**
 * 목록에 없는 오래된 지난 회차를 하나만 따로 읽는다. 목록은 최근 지난 회차만 담으므로
 * 예전에 공유된 상품 링크(`?round=`)가 깨지지 않게 하는 보조 조회다. roundId가 null이면 부르지 않는다.
 */
export function usePublicSaleRound(
  storeId: string | null,
  roundId: string | null,
): PublicSaleRoundLookup {
  const [lookup, setLookup] = useState<{ key: string; round: PublicSaleRound | null } | null>(null);
  const key = storeId && roundId ? `${storeId}/${roundId}` : null;

  useEffect(() => {
    if (!storeId || !roundId || !key) return;
    let active = true;
    void fetchPublicSaleRound(storeId, roundId).then((round) => {
      if (active) setLookup({ key, round });
    });
    return () => {
      active = false;
    };
  }, [storeId, roundId, key]);

  if (!key) return { status: 'idle', round: null };
  if (lookup?.key !== key) return { status: 'loading', round: null };
  return lookup.round
    ? { status: 'ready', round: lookup.round }
    : { status: 'missing', round: null };
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
      const nextState = await loadPublicSaleRoundsState(target);
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
      const nextState = await loadPublicSaleRoundsState(target, { fresh: true });
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
