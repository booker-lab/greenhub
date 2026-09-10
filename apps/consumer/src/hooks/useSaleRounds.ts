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

export function useSaleRounds(storeId: string | null): UseSaleRoundsResult {
  const [state, setState] = useState<SaleRoundsState>(createLoadingSaleRoundsState);
  const requestId = useRef(0);
  const scopeRef = useRef<string | null>(storeId);
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

  return { ...state, refetch };
}
