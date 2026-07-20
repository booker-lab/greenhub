'use client';

import type { SaleRound, SaleRoundStatus } from '@greenhub/shared';
import {
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { AlertTriangle, CalendarDays, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { EmptyState, LoadingState } from '@/components/StateViews';
import {
  type CreateSaleRoundInput,
  type SellerSaleRound,
  useSaleRounds,
} from '@/hooks/useSaleRounds';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import {
  buildRoundPageData,
  getRoundAction,
  type RoundAction,
  type RoundPageData,
  readSafeRoundId,
} from './page.logic';
import { RoundForm } from './RoundForm';

const STATUS_META: Record<SaleRoundStatus, { label: string; color: string }> = {
  DRAFT: { label: '작성 중', color: 'gray' },
  SCHEDULED: { label: '판매 예정', color: 'blue' },
  OPEN: { label: '판매 중', color: 'green' },
  CLOSED: { label: '주문 마감', color: 'orange' },
  COMPLETED: { label: '배송 완료', color: 'teal' },
  CANCELLED: { label: '취소', color: 'red' },
};

const CLOSE_REASON_LABEL = {
  SCHEDULE_ENDED: '일정 마감',
  CAPACITY: '한도 마감',
  MANUAL: '수동 마감',
} as const;

const ACTION_META: Record<
  RoundAction,
  {
    buttonLabel: string;
    title: string;
    message: string;
    confirmLabel: string;
    color: string;
  }
> = {
  schedule: {
    buttonLabel: '판매 예정으로 예약',
    title: '판매 예정 예약',
    message: '저장한 일정과 상품으로 이 회차를 판매 예정 상태로 예약합니다.',
    confirmLabel: '예약 확인',
    color: 'brand',
  },
  close: {
    buttonLabel: '주문 마감',
    title: '회차 주문 마감',
    message: '판매 중인 회차의 주문을 수동 마감합니다. 이 동작은 자동으로 되돌릴 수 없습니다.',
    confirmLabel: '마감 확인',
    color: 'orange',
  },
  complete: {
    buttonLabel: '회차 완료',
    title: '회차 배송 완료',
    message: '미완료 또는 배송 보류 주문이 없는지 서버에서 다시 확인한 뒤 회차를 완료합니다.',
    confirmLabel: '완료 확인',
    color: 'teal',
  },
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function mergeRoundSummary(round: SellerSaleRound, summary: SaleRound): SellerSaleRound {
  return { ...round, ...summary, items: round.items };
}

function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Paper role="alert" radius="lg" shadow="xs" p="xl">
      <Stack align="center" gap="sm">
        <AlertTriangle size={36} color="var(--color-danger)" />
        <Text style={{ fontWeight: 'var(--fw-bold)' }}>{title}</Text>
        <Text
          ta="center"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {message}
        </Text>
        <Button
          variant="light"
          color="red"
          leftSection={<RefreshCcw size={16} />}
          onClick={onRetry}
        >
          다시 조회
        </Button>
      </Stack>
    </Paper>
  );
}

function RoundSummary({ round }: { round: SellerSaleRound }) {
  const status = STATUS_META[round.status];
  const attentionCount =
    round.counters.heldOrderCount + (round.cancellation?.status === 'LOCAL_FAILED' ? 1 : 0);

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Group gap="xs">
              <Badge color={status.color} variant="light">
                {status.label}
              </Badge>
              {round.closeReason && (
                <Badge color="gray" variant="outline">
                  {CLOSE_REASON_LABEL[round.closeReason]}
                </Badge>
              )}
            </Group>
            <Text mt={6} style={{ fontWeight: 'var(--fw-bold)' }}>
              {round.name}
            </Text>
          </Box>
          {attentionCount > 0 && (
            <Button
              component={Link}
              href="/orders?tab=ACTION_REQUIRED"
              size="xs"
              variant="light"
              color="red"
            >
              확인 필요 {attentionCount.toLocaleString()}건
            </Button>
          )}
        </Group>
        <SimpleGrid cols={{ base: 1, xs: 3 }}>
          <Box>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              주문 배송지
            </Text>
            <Text style={{ fontWeight: 'var(--fw-medium)' }}>
              {round.counters.orderedDeliveryAddresses.toLocaleString()} /{' '}
              {round.limits.maxDeliveryAddresses.toLocaleString()}
            </Text>
          </Box>
          <Box>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              판매 수량
            </Text>
            <Text style={{ fontWeight: 'var(--fw-medium)' }}>
              {round.counters.orderedItemQuantity.toLocaleString()} /{' '}
              {round.limits.maxItemQuantity.toLocaleString()}
            </Text>
          </Box>
          <Box>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              배송 보류
            </Text>
            <Text
              style={{
                fontWeight: 'var(--fw-medium)',
                color:
                  round.counters.heldOrderCount > 0 ? 'var(--color-danger)' : 'var(--color-text)',
              }}
            >
              {round.counters.heldOrderCount.toLocaleString()}건
            </Text>
          </Box>
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}

function RoundEditor({
  round,
  disabled,
  onSave,
  onRetry,
}: {
  round: SellerSaleRound;
  disabled: boolean;
  onSave: (input: CreateSaleRoundInput) => Promise<void>;
  onRetry: () => void;
}) {
  const { products, loading, error } = useStoreProducts(round.storeId);

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <ErrorState title="스토어 상품을 불러오지 못했습니다" message={error} onRetry={onRetry} />
    );
  }

  let pageData: RoundPageData;
  try {
    pageData = buildRoundPageData(round, products);
  } catch (dataError) {
    return (
      <ErrorState
        title="회차 편집 데이터를 확인할 수 없습니다"
        message={errorMessage(dataError, '회차 편집 응답이 올바르지 않습니다.')}
        onRetry={onRetry}
      />
    );
  }

  return (
    <Stack gap="md">
      {pageData.products.length === 0 && (
        <Alert color="yellow" title="현재 스토어 상품이 없습니다">
          기존 회차 상품은 확인할 수 있지만 새 상품을 추가할 수 없습니다.
        </Alert>
      )}
      <RoundForm
        round={round}
        products={pageData.products}
        carrotLinks={pageData.carrotLinks}
        onSave={onSave}
        disabled={disabled}
      />
    </Stack>
  );
}

function SaleRoundDetail({ roundId, onRetry }: { roundId: string; onRetry: () => void }) {
  const {
    pendingOperation,
    operationLoading,
    getRound,
    saveRound,
    changeStatus,
    completeRound,
    clearOperationError,
  } = useSaleRounds();
  const [round, setRound] = useState<SellerSaleRound | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [action, setAction] = useState<RoundAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const currentRequestId = ++requestId.current;
    setDetailLoading(true);
    setDetailError(null);
    void getRound(roundId)
      .then((loadedRound) => {
        if (requestId.current === currentRequestId) setRound(loadedRound);
      })
      .catch((loadError) => {
        if (requestId.current === currentRequestId) {
          setRound(null);
          setDetailError(errorMessage(loadError, '회차 상세를 불러오지 못했습니다.'));
        }
      })
      .finally(() => {
        if (requestId.current === currentRequestId) setDetailLoading(false);
      });
    return () => {
      requestId.current += 1;
    };
  }, [getRound, roundId]);

  const handleSave = async (input: CreateSaleRoundInput) => {
    clearOperationError();
    setActionError(null);
    setActionSuccess(null);
    const savedRound = await saveRound(roundId, input);
    setRound(savedRound);
  };

  const handleAction = async () => {
    if (!round || !action || getRoundAction(round.status) !== action) return;
    clearOperationError();
    setActionError(null);
    setActionSuccess(null);

    try {
      const updated =
        action === 'complete'
          ? await completeRound(roundId)
          : await changeStatus(roundId, action === 'schedule' ? 'SCHEDULED' : 'CLOSED');
      setRound((current) => (current ? mergeRoundSummary(current, updated) : current));
      setActionSuccess(
        action === 'schedule'
          ? '회차를 판매 예정으로 예약했습니다.'
          : action === 'close'
            ? '회차 주문을 수동 마감했습니다.'
            : '회차 배송을 완료했습니다.',
      );
      setAction(null);
    } catch (requestError) {
      setActionError(errorMessage(requestError, '회차 상태를 변경하지 못했습니다.'));
      setAction(null);
    }
  };

  if (detailLoading) return <LoadingState />;
  if (detailError || !round) {
    return (
      <ErrorState
        title="회차 상세를 불러오지 못했습니다"
        message={detailError ?? '회차 상세 응답이 비어 있습니다.'}
        onRetry={onRetry}
      />
    );
  }

  const availableAction = getRoundAction(round.status);

  return (
    <>
      <Stack gap="md">
        <RoundSummary round={round} />
        {actionSuccess && (
          <Alert color="green" title="상태 변경 완료" role="status">
            {actionSuccess}
          </Alert>
        )}
        {actionError && (
          <Alert color="red" title="상태 변경 실패" role="alert">
            {actionError}
          </Alert>
        )}
        {availableAction && (
          <Button
            variant={availableAction === 'schedule' ? 'filled' : 'outline'}
            color={ACTION_META[availableAction].color}
            onClick={() => {
              clearOperationError();
              setActionError(null);
              setAction(availableAction);
            }}
            disabled={operationLoading}
          >
            {ACTION_META[availableAction].buttonLabel}
          </Button>
        )}
        <RoundEditor
          key={round.storeId}
          round={round}
          disabled={operationLoading}
          onSave={handleSave}
          onRetry={onRetry}
        />
      </Stack>

      {action && (
        <ConfirmModal
          opened
          title={ACTION_META[action].title}
          message={ACTION_META[action].message}
          confirmLabel={ACTION_META[action].confirmLabel}
          confirmColor={ACTION_META[action].color}
          loading={pendingOperation === (action === 'complete' ? 'complete' : 'status')}
          onConfirm={handleAction}
          onClose={() => {
            if (!operationLoading) setAction(null);
          }}
        />
      )}
    </>
  );
}

export default function SaleRoundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roundId = readSafeRoundId(resolvedParams.id);
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <PageShell>
      <PageHeader title="판매 회차 상세" onBack={() => router.push('/sale-rounds')} />
      <Container size="sm" px="md" py="md">
        {!roundId ? (
          <EmptyState
            icon={<CalendarDays size={48} strokeWidth={1.5} />}
            text="올바른 회차를 찾을 수 없습니다"
            action={
              <Button component={Link} href="/sale-rounds" variant="light">
                회차 목록으로
              </Button>
            }
          />
        ) : (
          <SaleRoundDetail
            key={`${roundId}:${reloadKey}`}
            roundId={roundId}
            onRetry={() => setReloadKey((current) => current + 1)}
          />
        )}
      </Container>
    </PageShell>
  );
}
