'use client';

import type { SaleRound, SaleRoundStatus } from '@greenhub/shared';
import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { AlertTriangle, CalendarDays, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { use, useEffect, useRef, useState } from 'react';
import { type ConfirmColor, ConfirmModal } from '@/components/ConfirmModal';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { RoundDeadlineStrip } from '@/components/RoundDeadlineStrip';
import { RoundPurchaseListCard } from '@/components/RoundPurchaseListCard';
import { EmptyState, LoadingState } from '@/components/StateViews';
import {
  type CreateSaleRoundInput,
  type SellerSaleRound,
  useSaleRounds,
} from '@/hooks/useSaleRounds';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import { showsRoundOrders } from '@/lib/round-orders';
import { isPurchaseListRound } from '@/lib/round-purchase-list';
import {
  buildRoundPageData,
  getRoundAction,
  isRoundEditable,
  type RoundAction,
  type RoundPageData,
  readSafeRoundId,
  resolveRoundCancelAction,
  resolveRoundCancellationProgress,
} from './page.logic';
import { RoundCancelModal } from './RoundCancelModal';
import { RoundForm } from './RoundForm';
import { RoundOrdersSection } from './RoundOrdersSection';

// 상태 배지는 Mantine Badge light의 색(gray·yellow·brand·dark·red)과 같은 변형이다.
const STATUS_META: Record<
  SaleRoundStatus,
  {
    label: string;
    badge: 'secondary' | 'warning' | 'light' | 'light-dark' | 'destructive';
  }
> = {
  DRAFT: { label: '작성 중', badge: 'secondary' },
  SCHEDULED: { label: '판매 예정', badge: 'warning' },
  OPEN: { label: '판매 중', badge: 'light' },
  CLOSED: { label: '주문 마감', badge: 'light-dark' },
  COMPLETED: { label: '배송 완료', badge: 'secondary' },
  CANCELLED: { label: '취소', badge: 'destructive' },
};

// ① 외형 유지(UI 교체 P4): Mantine Paper·Text·Group·Stack·SimpleGrid·Container·Alert·Badge·Button과 같은 값을
// Tailwind와 @greenhub/ui로 그린다. Text = p(16px·줄 높이 1.55·여백 0), Paper = 흰 바탕·모서리 16·그림자 xs.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER = 'block rounded-[16px] bg-white shadow-mantine-xs';
const COLUMN = 'flex flex-col items-stretch justify-start';

// 상태 변경 버튼: 예약은 Mantine filled brand, 마감은 outline dark, 완료는 outline brand와 같은 변형이다.
const ACTION_BUTTON_VARIANT: Record<RoundAction, 'default' | 'outline-dark' | 'outline'> = {
  schedule: 'default',
  close: 'outline-dark',
  complete: 'outline',
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
    color: ConfirmColor;
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
    color: 'dark',
  },
  complete: {
    buttonLabel: '회차 완료',
    title: '회차 배송 완료',
    message: '미완료 또는 배송 보류 주문이 없는지 서버에서 다시 확인한 뒤 회차를 완료합니다.',
    confirmLabel: '완료 확인',
    color: 'brand',
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
    <div role="alert" className={`${PAPER} p-8`}>
      <div className="flex flex-col items-center justify-start gap-3">
        <AlertTriangle size={36} color="var(--color-danger)" />
        <p className={TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
          {title}
        </p>
        <p
          className={`${TEXT} text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {message}
        </p>
        <Button variant="light-destructive" onClick={onRetry}>
          <RefreshCcw className="size-4" data-icon="inline-start" />
          다시 조회
        </Button>
      </div>
    </div>
  );
}

// 디자인 기준 §5: 판매자 요약 숫자는 연두 상자. 배송 보류가 있으면 문제 상태라 빨강 연한 면.
// 라벨과 값은 같은 부모 아래 형제로 둔다(회차 E2E가 라벨의 부모에서 값을 찾는다).
function SummaryStat({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className="p-3"
      style={{
        background: alert ? 'var(--color-danger-surface)' : 'var(--color-primary-surface)',
        borderRadius: 'var(--radius-tag)',
      }}
    >
      <p
        className={TEXT}
        style={{
          fontSize: 'var(--font-size-xs)',
          fontWeight: 'var(--fw-bold)',
          color: alert ? 'var(--color-danger)' : 'var(--color-text-secondary)',
        }}
      >
        {label}
      </p>
      <p
        className={TEXT}
        style={{
          marginTop: 2,
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--fw-extrabold)',
          fontVariantNumeric: 'tabular-nums',
          color: alert ? 'var(--color-danger)' : 'var(--color-text)',
        }}
      >
        {value}
      </p>
    </div>
  );
}

function RoundSummary({ round }: { round: SellerSaleRound }) {
  const status = STATUS_META[round.status];
  const attentionCount =
    round.counters.heldOrderCount + (round.cancellation?.status === 'LOCAL_FAILED' ? 1 : 0);

  return (
    <div className={`${PAPER} p-4`}>
      <div className={`${COLUMN} gap-4`}>
        <div className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
              <Badge variant={status.badge}>{status.label}</Badge>
              {round.closeReason && (
                <Badge variant="outline-gray">{CLOSE_REASON_LABEL[round.closeReason]}</Badge>
              )}
            </div>
            <p className={TEXT} style={{ marginTop: 6, fontWeight: 'var(--fw-bold)' }}>
              {round.name}
            </p>
          </div>
          {attentionCount > 0 && (
            <Button
              render={<Link href="/orders?tab=ACTION_REQUIRED" />}
              nativeButton={false}
              size="xs"
              variant="light-destructive"
            >
              확인 필요 {attentionCount.toLocaleString()}건
            </Button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <SummaryStat
            label="주문 배송지"
            value={`${round.counters.orderedDeliveryAddresses.toLocaleString()} / ${round.limits.maxDeliveryAddresses.toLocaleString()}`}
          />
          <SummaryStat
            label="판매 수량"
            value={`${round.counters.orderedItemQuantity.toLocaleString()} / ${round.limits.maxItemQuantity.toLocaleString()}`}
          />
          <SummaryStat
            label="배송 보류"
            value={`${round.counters.heldOrderCount.toLocaleString()}건`}
            alert={round.counters.heldOrderCount > 0}
          />
        </div>
      </div>
    </div>
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
  const { products, loading, error, retry: retryProducts } = useStoreProducts(round.storeId);

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <ErrorState
        title="스토어 상품을 불러오지 못했습니다"
        message={error}
        onRetry={() => {
          retryProducts();
          onRetry();
        }}
      />
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
    <div className={`${COLUMN} gap-4`}>
      {pageData.products.length === 0 && (
        <Alert variant="warning" role="alert">
          <AlertTitle>현재 스토어 상품이 없습니다</AlertTitle>
          <AlertDescription>
            기존 회차 상품은 확인할 수 있지만 새 상품을 추가할 수 없습니다.
          </AlertDescription>
        </Alert>
      )}
      <RoundForm
        round={round}
        products={pageData.products}
        carrotLinks={pageData.carrotLinks}
        onSave={onSave}
        disabled={disabled}
        readOnly={!isRoundEditable(round)}
      />
    </div>
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
  const { data: session } = useSession();
  const role = session?.user.role ?? null;
  const [round, setRound] = useState<SellerSaleRound | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [action, setAction] = useState<RoundAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
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

  // 회차 취소(관리자 전용) — 기존 상태 변경 PATCH {status:'CANCELLED'}. 멈춘 취소도 같은 요청으로 잇는다.
  const handleCancelRound = async () => {
    if (!round) return;
    clearOperationError();
    setActionError(null);
    setActionSuccess(null);
    try {
      const updated = await changeStatus(roundId, 'CANCELLED');
      setRound((current) => (current ? mergeRoundSummary(current, updated) : current));
      setActionSuccess('회차를 취소했어요. 결제된 주문은 모두 환불했어요.');
    } catch (requestError) {
      setActionError(errorMessage(requestError, '회차를 취소하지 못했어요.'));
      // 실패해도 서버의 취소 진행 상태가 바뀌었을 수 있어 다시 읽는다(멈춤이면 "다시 진행"이 보인다).
      try {
        setRound(await getRound(roundId));
      } catch {
        // 다시 읽기 실패는 위 오류 안내로 충분하다.
      }
    } finally {
      setCancelOpen(false);
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
  const now = Date.now();
  const cancelProgress = resolveRoundCancellationProgress(round, now);
  const cancelAction = resolveRoundCancelAction(round, role, now);

  return (
    <>
      <div className={`${COLUMN} gap-4`}>
        <RoundDeadlineStrip round={round} rounded />
        <RoundSummary round={round} />
        {showsRoundOrders(round.status) && <RoundOrdersSection round={round} />}
        {isPurchaseListRound(round) && <RoundPurchaseListCard round={round} />}
        {actionSuccess && (
          <Alert role="status">
            <AlertTitle>상태 변경 완료</AlertTitle>
            <AlertDescription>{actionSuccess}</AlertDescription>
          </Alert>
        )}
        {actionError && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>상태 변경 실패</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}
        {availableAction && (
          <Button
            variant={ACTION_BUTTON_VARIANT[availableAction]}
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
        {cancelProgress === 'RUNNING' && (
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            회차 취소를 처리하고 있어요. 몇 분 뒤 새로고침해서 확인해 주세요.
          </p>
        )}
        {cancelProgress === 'STUCK' && !cancelAction && (
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          >
            회차 취소가 끝나지 않았어요. 관리자 계정에서 &lsquo;회차 취소 다시 진행&rsquo;을 눌러야
            해요.
          </p>
        )}
        {cancelAction && (
          <Button
            variant="subtle-destructive"
            onClick={() => {
              clearOperationError();
              setActionError(null);
              setCancelOpen(true);
            }}
            disabled={operationLoading}
          >
            {cancelAction === 'resume' ? '회차 취소 다시 진행' : '회차 취소'}
          </Button>
        )}
        <RoundEditor
          key={round.storeId}
          round={round}
          disabled={operationLoading}
          onSave={handleSave}
          onRetry={onRetry}
        />
      </div>

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

      <RoundCancelModal
        opened={cancelOpen}
        roundName={round.name}
        resume={cancelAction === 'resume'}
        loading={pendingOperation === 'status'}
        onConfirm={handleCancelRound}
        onClose={() => setCancelOpen(false)}
      />
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
      <div className="mx-auto max-w-[720px] px-4 py-4">
        {!roundId ? (
          <EmptyState
            icon={<CalendarDays size={48} strokeWidth={1.5} />}
            text="올바른 회차를 찾을 수 없습니다"
            action={
              <Button render={<Link href="/sale-rounds" />} nativeButton={false} variant="light">
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
      </div>
    </PageShell>
  );
}
