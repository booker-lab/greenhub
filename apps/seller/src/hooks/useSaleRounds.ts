'use client';

import type {
  SaleRound,
  SaleRoundDeliveryRegion,
  SaleRoundItem,
  SaleRoundLimits,
  SaleRoundSchedule,
  SaleRoundStatus,
} from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '@/lib/api';

const SALE_ROUND_STATUSES = new Set<SaleRoundStatus>([
  'DRAFT',
  'SCHEDULED',
  'OPEN',
  'CLOSED',
  'COMPLETED',
  'CANCELLED',
]);
const SALE_ROUND_CLOSE_REASONS = new Set(['SCHEDULE_ENDED', 'CAPACITY', 'MANUAL']);
const SALE_ROUND_CANCELLATION_STATUSES = new Set(['CANCELLING', 'LOCAL_FAILED', 'COMPLETED']);
const SALE_ROUND_ITEM_STATUSES = new Set(['ACTIVE', 'HIDDEN', 'SOLD_OUT', 'CLOSED']);

export interface SaleRoundItemInput {
  productId: string;
  roundPrice: number;
  saleLimitQuantity: number;
  displayOrder: number;
}

export interface CreateSaleRoundInput {
  name: string;
  schedule: SaleRoundSchedule;
  deliveryRegion: SaleRoundDeliveryRegion;
  limits: SaleRoundLimits;
  items: SaleRoundItemInput[];
  carrotLandingUrl?: string;
}

export type UpdateSaleRoundInput = Partial<CreateSaleRoundInput>;

export interface CopySaleRoundInput {
  sourceRoundId: string;
  name: string;
  schedule: SaleRoundSchedule;
  carrotLandingUrl?: string;
}

export type SellerSaleRound = SaleRound & { items: SaleRoundItem[] };
export type SaleRoundOperation = 'detail' | 'create' | 'save' | 'copy' | 'status' | 'complete';

export interface UseSaleRoundsResult {
  rounds: SaleRound[];
  loading: boolean;
  error: string | null;
  pendingOperation: SaleRoundOperation | null;
  operationLoading: boolean;
  operationError: string | null;
  refetch: () => Promise<void>;
  getRound: (roundId: string) => Promise<SellerSaleRound>;
  createRound: (input: CreateSaleRoundInput) => Promise<SellerSaleRound>;
  saveRound: (roundId: string, input: UpdateSaleRoundInput) => Promise<SellerSaleRound>;
  copyRound: (input: CopySaleRoundInput) => Promise<SellerSaleRound>;
  changeStatus: (roundId: string, status: SaleRoundStatus) => Promise<SaleRound>;
  completeRound: (roundId: string) => Promise<SaleRound>;
  clearOperationError: () => void;
}

type ApiContext = {
  storeId: string;
  accessToken: string;
  basePath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isIsoString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value)) && value.includes('T');
}

function isNullableIsoString(value: unknown): value is string | null {
  return value === null || isIsoString(value);
}

function isSaleRoundStatus(value: unknown): value is SaleRoundStatus {
  return typeof value === 'string' && SALE_ROUND_STATUSES.has(value as SaleRoundStatus);
}

function hasRoundShape(value: Record<string, unknown>): boolean {
  const schedule = value.schedule;
  const deliveryRegion = value.deliveryRegion;
  const limits = value.limits;
  const counters = value.counters;
  const cancellation = value.cancellation;

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.storeId) &&
    isNonEmptyString(value.name) &&
    isSaleRoundStatus(value.status) &&
    (value.closeReason === null ||
      (typeof value.closeReason === 'string' && SALE_ROUND_CLOSE_REASONS.has(value.closeReason))) &&
    isRecord(schedule) &&
    isIsoString(schedule.orderOpenAt) &&
    isIsoString(schedule.orderCloseAt) &&
    isIsoString(schedule.auctionAt) &&
    isIsoString(schedule.deliveryStartAt) &&
    isIsoString(schedule.deliveryEndAt) &&
    schedule.timezone === 'Asia/Seoul' &&
    isRecord(deliveryRegion) &&
    isNonEmptyString(deliveryRegion.id) &&
    isNonEmptyString(deliveryRegion.label) &&
    isNonEmptyString(deliveryRegion.province) &&
    isNonEmptyString(deliveryRegion.city) &&
    typeof deliveryRegion.enabled === 'boolean' &&
    isRecord(limits) &&
    isPositiveInteger(limits.maxDeliveryAddresses) &&
    isPositiveInteger(limits.maxItemQuantity) &&
    isRecord(counters) &&
    isNonNegativeInteger(counters.reservedDeliveryAddresses) &&
    isNonNegativeInteger(counters.reservedItemQuantity) &&
    isNonNegativeInteger(counters.orderedDeliveryAddresses) &&
    isNonNegativeInteger(counters.orderedItemQuantity) &&
    isNonNegativeInteger(counters.heldOrderCount) &&
    (value.carrotLandingUrl === null || typeof value.carrotLandingUrl === 'string') &&
    (cancellation === null ||
      (isRecord(cancellation) &&
        typeof cancellation.status === 'string' &&
        SALE_ROUND_CANCELLATION_STATUSES.has(cancellation.status) &&
        isNonEmptyString(cancellation.reason) &&
        (cancellation.failedOrderId === null || isNonEmptyString(cancellation.failedOrderId)) &&
        isIsoString(cancellation.updatedAt) &&
        isNullableIsoString(cancellation.completedAt))) &&
    isNullableIsoString(value.cancelledAt) &&
    isNullableIsoString(value.completedAt) &&
    isIsoString(value.createdAt) &&
    isIsoString(value.updatedAt)
  );
}

function readRoundSummary(
  payload: unknown,
  expectedStoreId: string,
  expectedRoundId?: string,
): SaleRound {
  if (
    !isRecord(payload) ||
    !hasRoundShape(payload) ||
    payload.storeId !== expectedStoreId ||
    (expectedRoundId !== undefined && payload.id !== expectedRoundId)
  ) {
    throw new Error('회차 응답 형식이 올바르지 않습니다.');
  }
  return payload as unknown as SaleRound;
}

function readRoundDetail(
  payload: unknown,
  expectedStoreId: string,
  expectedRoundId?: string,
): SellerSaleRound {
  const round = readRoundSummary(payload, expectedStoreId, expectedRoundId);
  const items = (payload as Record<string, unknown>).items;
  if (
    !Array.isArray(items) ||
    items.some(
      (item) =>
        !isRecord(item) ||
        !isNonEmptyString(item.id) ||
        item.roundId !== round.id ||
        item.storeId !== expectedStoreId ||
        !isNonEmptyString(item.productId) ||
        !isNonEmptyString(item.productNameSnapshot) ||
        (item.productImageUrlSnapshot !== null &&
          typeof item.productImageUrlSnapshot !== 'string') ||
        !isPositiveInteger(item.roundPrice) ||
        !isPositiveInteger(item.saleLimitQuantity) ||
        !isNonNegativeInteger(item.reservedQuantity) ||
        !isNonNegativeInteger(item.orderedQuantity) ||
        !isNonNegativeInteger(item.displayOrder) ||
        typeof item.status !== 'string' ||
        !SALE_ROUND_ITEM_STATUSES.has(item.status) ||
        !isIsoString(item.createdAt) ||
        !isIsoString(item.updatedAt),
    )
  ) {
    throw new Error('회차 상세 응답 형식이 올바르지 않습니다.');
  }
  return payload as SellerSaleRound;
}

function readRoundList(payload: unknown, expectedStoreId: string): SaleRound[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error('회차 목록 응답 형식이 올바르지 않습니다.');
  }
  return payload.items.map((round) => readRoundSummary(round, expectedStoreId));
}

function toRoundSummary(round: SaleRound): SaleRound {
  const { items: _items, ...summary } = round as SaleRound & { items?: unknown };
  return summary;
}

function mergeRound(rounds: SaleRound[], round: SaleRound): SaleRound[] {
  const summary = toRoundSummary(round);
  const index = rounds.findIndex((item) => item.id === summary.id);
  if (index === -1) return [summary, ...rounds];
  return rounds.map((item, itemIndex) => (itemIndex === index ? summary : item));
}

function requireIdentifier(value: string, label: string): string {
  if (!isNonEmptyString(value)) throw new Error(`${label}이(가) 필요합니다.`);
  return encodeURIComponent(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * 셀러 소유 스토어의 회차 API 경계.
 * 목록 재조회는 늦게 도착한 이전 요청을 폐기하며, mutation 성공 응답을 먼저 반영한 뒤
 * 서버 목록을 다시 조회한다. 재조회 실패 시 확인된 mutation 결과는 유지하고 `error`에 남긴다.
 */
export function useSaleRounds(): UseSaleRoundsResult {
  const { data: session, status: sessionStatus } = useSession();
  const storeId = session?.user.storeId;
  const accessToken = session?.user.accessToken;

  const [rounds, setRounds] = useState<SaleRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<SaleRoundOperation | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const listRequestId = useRef(0);
  const operationRef = useRef<SaleRoundOperation | null>(null);

  const getApiContext = useCallback((): ApiContext => {
    if (!storeId || !accessToken) {
      throw new Error('셀러 스토어 인증 정보를 확인할 수 없습니다.');
    }
    return {
      storeId,
      accessToken,
      basePath: `/stores/${encodeURIComponent(storeId)}/sale-rounds`,
    };
  }, [storeId, accessToken]);

  const loadRounds = useCallback(async () => {
    const currentRequestId = ++listRequestId.current;
    if (sessionStatus === 'loading') {
      setLoading(true);
      return;
    }
    if (!storeId || !accessToken) {
      setRounds([]);
      setLoading(false);
      setError('셀러 스토어 인증 정보를 확인할 수 없습니다.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await apiJson(
        `/stores/${encodeURIComponent(storeId)}/sale-rounds`,
        accessToken,
      );
      const nextRounds = readRoundList(payload, storeId);
      if (listRequestId.current === currentRequestId) setRounds(nextRounds);
    } catch (requestError) {
      if (listRequestId.current === currentRequestId) {
        setError(errorMessage(requestError, '회차 목록을 불러오지 못했습니다.'));
      }
    } finally {
      if (listRequestId.current === currentRequestId) setLoading(false);
    }
  }, [sessionStatus, storeId, accessToken]);

  useEffect(() => {
    void loadRounds();
    return () => {
      listRequestId.current += 1;
    };
  }, [loadRounds]);

  const runOperation = useCallback(
    async <T>(
      operation: SaleRoundOperation,
      request: (context: ApiContext) => Promise<T>,
      changedRound?: (result: T) => SaleRound,
    ): Promise<T> => {
      if (operationRef.current) {
        const concurrentError = new Error('진행 중인 회차 작업이 끝난 뒤 다시 시도해 주세요.');
        setOperationError(concurrentError.message);
        throw concurrentError;
      }

      operationRef.current = operation;
      setPendingOperation(operation);
      setOperationError(null);
      try {
        const result = await request(getApiContext());
        if (changedRound) {
          setRounds((current) => mergeRound(current, changedRound(result)));
          await loadRounds();
        }
        return result;
      } catch (requestError) {
        setOperationError(errorMessage(requestError, '회차 작업을 완료하지 못했습니다.'));
        throw requestError;
      } finally {
        operationRef.current = null;
        setPendingOperation(null);
      }
    },
    [getApiContext, loadRounds],
  );

  const getRound = useCallback(
    (roundId: string) =>
      runOperation('detail', async (context) => {
        const safeRoundId = requireIdentifier(roundId, '회차 ID');
        const payload = await apiJson(`${context.basePath}/${safeRoundId}`, context.accessToken);
        return readRoundDetail(payload, context.storeId, roundId);
      }),
    [runOperation],
  );

  const createRound = useCallback(
    (input: CreateSaleRoundInput) =>
      runOperation(
        'create',
        async (context) => {
          const payload = await apiJson(context.basePath, context.accessToken, {
            method: 'POST',
            body: JSON.stringify(input),
          });
          return readRoundDetail(payload, context.storeId);
        },
        (round) => round,
      ),
    [runOperation],
  );

  const saveRound = useCallback(
    (roundId: string, input: UpdateSaleRoundInput) =>
      runOperation(
        'save',
        async (context) => {
          const safeRoundId = requireIdentifier(roundId, '회차 ID');
          const payload = await apiJson(`${context.basePath}/${safeRoundId}`, context.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(input),
          });
          return readRoundDetail(payload, context.storeId, roundId);
        },
        (round) => round,
      ),
    [runOperation],
  );

  const copyRound = useCallback(
    (input: CopySaleRoundInput) =>
      runOperation(
        'copy',
        async (context) => {
          const payload = await apiJson(`${context.basePath}/copy`, context.accessToken, {
            method: 'POST',
            body: JSON.stringify(input),
          });
          return readRoundDetail(payload, context.storeId);
        },
        (round) => round,
      ),
    [runOperation],
  );

  const changeStatus = useCallback(
    (roundId: string, status: SaleRoundStatus) =>
      runOperation(
        'status',
        async (context) => {
          const safeRoundId = requireIdentifier(roundId, '회차 ID');
          const payload = await apiJson(
            `${context.basePath}/${safeRoundId}/status`,
            context.accessToken,
            {
              method: 'PATCH',
              body: JSON.stringify({ status }),
            },
          );
          return readRoundSummary(payload, context.storeId, roundId);
        },
        (round) => round,
      ),
    [runOperation],
  );

  const completeRound = useCallback(
    (roundId: string) =>
      runOperation(
        'complete',
        async (context) => {
          const safeRoundId = requireIdentifier(roundId, '회차 ID');
          const payload = await apiJson(
            `${context.basePath}/${safeRoundId}/complete`,
            context.accessToken,
            { method: 'PATCH' },
          );
          return readRoundSummary(payload, context.storeId, roundId);
        },
        (round) => round,
      ),
    [runOperation],
  );

  const clearOperationError = useCallback(() => setOperationError(null), []);

  return {
    rounds,
    loading,
    error,
    pendingOperation,
    operationLoading: pendingOperation !== null,
    operationError,
    refetch: loadRounds,
    getRound,
    createRound,
    saveRound,
    copyRound,
    changeStatus,
    completeRound,
    clearOperationError,
  };
}
