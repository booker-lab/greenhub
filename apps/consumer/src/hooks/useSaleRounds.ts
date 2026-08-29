'use client';

import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API_URL = getApiBaseUrl();

export type PublicSaleRound = SaleRound & { items: SaleRoundItem[] };
export type SaleRoundsRequestStatus = 'loading' | 'error' | 'empty' | 'success';

export interface SaleRoundsState {
  rounds: PublicSaleRound[];
  currentRound: PublicSaleRound | null;
  pastRounds: PublicSaleRound[];
  status: SaleRoundsRequestStatus;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
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
  };
}

function createEmptySaleRoundsState(): SaleRoundsState {
  return {
    ...emptyData(),
    status: 'empty',
    loading: false,
    error: null,
    isEmpty: true,
  };
}

function createErrorSaleRoundsState(error: unknown): SaleRoundsState {
  return {
    ...emptyData(),
    status: 'error',
    loading: false,
    error: error instanceof Error ? error.message : '회차 조회에 실패했습니다.',
    isEmpty: false,
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
  };
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

  const loadRounds = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    if (!storeId) {
      setState(createEmptySaleRoundsState());
      return;
    }

    setState(createLoadingSaleRoundsState());
    const nextState = await fetchPublicSaleRoundsState(storeId);
    if (requestId.current === currentRequestId) setState(nextState);
  }, [storeId]);

  useEffect(() => {
    void loadRounds();
    return () => {
      requestId.current += 1;
    };
  }, [loadRounds]);

  const refetch = useCallback(() => {
    void loadRounds();
  }, [loadRounds]);

  return { ...state, refetch };
}
