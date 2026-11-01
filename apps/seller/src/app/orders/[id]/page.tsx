'use client';

import { readRouteParam } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { CancelOrderModal } from './_components/CancelOrderModal';
import { DeliveryHoldModal } from './_components/DeliveryHoldModal';
import { OrderInfoSection } from './_components/OrderInfoSection';
import { OrderOperationsSection } from './_components/OrderOperationsSection';
import { PostDeliveryRefundSection } from './_components/PostDeliveryRefundSection';
import { PrepareForm } from './_components/PrepareForm';
import { useOrderDetail } from './_hooks/useOrderDetail';
import {
  getOrderDetailMutationOutcomeMessage,
  resolveOrderDetailMutationOutcome,
  SELLER_ORDER_DETAIL_AUTH_ERROR,
} from './_hooks/useOrderDetail.recovery';
import { useOrderDetailActions } from './_hooks/useOrderDetailActions';
import { useOrderOperations } from './_hooks/useOrderOperations';
import { READONLY_STATUSES } from './_lib';
import { holdReleaseMessage, resolveOrderDetailActions } from './order-actions';

// ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px, 좌우 16px)·Stack·Text(p, 여백 0, 줄 높이 1.55)·
// UnstyledButton과 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';
const CONTAINER = 'mx-auto max-w-[720px] px-4';

function DetailStatusBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--frame)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div className={`${CONTAINER} py-4`}>
        <div className="flex flex-col items-center gap-3">{children}</div>
      </div>
    </div>
  );
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  // 경로 파라미터는 형식을 검사한 원래 ID로 읽는다. 맞지 않으면 주문 요청을 보내지 않는다.
  const orderId = readRouteParam(params.id);

  if (!orderId) {
    return (
      <DetailStatusBox>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-medium)' }}
        >
          주문 주소가 올바르지 않습니다.
        </p>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          주문 목록에서 다시 선택해 주세요.
        </p>
        <button
          type="button"
          className={UNSTYLED_BUTTON}
          onClick={() => router.back()}
          style={{
            color: 'var(--color-primary-dark)',
            textDecoration: 'underline',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          돌아가기
        </button>
      </DetailStatusBox>
    );
  }

  return <OrderDetailContent orderId={orderId} />;
}

function OrderDetailContent({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;

  const {
    order,
    productName,
    groupConfig,
    refreshing,
    error: detailError,
    isStale,
    view,
    refresh,
    reconcile,
  } = useOrderDetail(orderId);
  // 직전 mutation command 성공 여부를 기억한다.
  // PATCH 성공 + 재조회 실패를 command 실패로 잘못 표현하지 않기 위한 최소 구분이다.
  const [mutationConfirmed, setMutationConfirmed] = useState(false);
  const handleReconciled = useCallback(() => {
    setMutationConfirmed(true);
    reconcile();
  }, [reconcile]);
  const {
    actionLoading,
    actionError,
    setActionError,
    showPrepareForm,
    setShowPrepareForm,
    preparedAt,
    setPreparedAt,
    showCancelModal,
    setShowCancelModal,
    cancelReason,
    setCancelReason,
    showHoldModal,
    setShowHoldModal,
    showReleaseConfirm,
    setShowReleaseConfirm,
    handlePrepare,
    handleCancel,
    handleShipParcel,
    handleHold,
    handleReleaseHold,
  } = useOrderDetailActions(storeId, orderId, handleReconciled);
  const {
    issues,
    loading: operationsLoading,
    actionIssueId,
    error: operationsError,
    reload: reloadOperations,
    executeAction,
  } = useOrderOperations(storeId, orderId);

  useEffect(() => {
    if (!isStale && !refreshing) setMutationConfirmed(false);
  }, [isStale, refreshing]);

  if (view === 'LOADING') {
    return <LoadingState fullPage />;
  }

  if (view === 'AUTH_FAILED') {
    return (
      <DetailStatusBox>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-medium)' }}
        >
          {SELLER_ORDER_DETAIL_AUTH_ERROR}
        </p>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          로그인 상태 확인 후 다시 시도해 주세요.
        </p>
        <Button onClick={refresh}>다시 시도</Button>
        <button
          type="button"
          className={UNSTYLED_BUTTON}
          onClick={() => router.back()}
          style={{
            color: 'var(--color-primary-dark)',
            textDecoration: 'underline',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          돌아가기
        </button>
      </DetailStatusBox>
    );
  }

  if (view === 'READ_FAILED') {
    return (
      <DetailStatusBox>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-medium)' }}
        >
          주문을 불러오지 못했습니다.
        </p>
        {detailError && (
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {detailError}
          </p>
        )}
        <Button onClick={refresh}>다시 시도</Button>
        <button
          type="button"
          className={UNSTYLED_BUTTON}
          onClick={() => router.back()}
          style={{
            color: 'var(--color-primary-dark)',
            textDecoration: 'underline',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          돌아가기
        </button>
      </DetailStatusBox>
    );
  }

  if (view === 'NOT_FOUND' || !order) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--frame)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
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
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          }
          text="주문을 찾을 수 없습니다"
          action={
            <button
              type="button"
              className={UNSTYLED_BUTTON}
              onClick={() => router.back()}
              style={{
                color: 'var(--color-primary-dark)',
                textDecoration: 'underline',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              돌아가기
            </button>
          }
        />
      </div>
    );
  }

  const isReadonly = READONLY_STATUSES.includes(order.status);
  // 상태별 버튼 — BUG-16 T3: 택배 주문은 PREPARING 단계에서 셀러가 직접 발송 완료 가능.
  const actions = resolveOrderDetailActions(order);
  const canPrepare = actions.prepare;
  const canCancel = actions.cancel;
  const canShipParcel = actions.shipParcel;
  const isHeld = actions.releaseHold;
  const showFooter =
    !isReadonly &&
    !showPrepareForm &&
    (canPrepare || canCancel || canShipParcel || actions.hold || actions.releaseHold);
  const deliveryDate =
    order.saleType === 'normal'
      ? order.requestedDeliveryDate
      : (groupConfig?.groupDeliveryDate?.slice(0, 10) ?? null);
  const reconcileOutcome = resolveOrderDetailMutationOutcome(true, isStale && mutationConfirmed);
  const reconcileMessage = getOrderDetailMutationOutcomeMessage(reconcileOutcome);

  return (
    <PageShell paddingBottom={showFooter ? 200 : 96}>
      <PageHeader title="주문 상세" onBack={() => router.back()} />

      <div className={`${CONTAINER} py-4`}>
        <div className="flex flex-col gap-3">
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {refreshing ? (
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                최신 상태 확인 중…
              </p>
            ) : (
              <button
                type="button"
                className={UNSTYLED_BUTTON}
                onClick={refresh}
                style={{
                  color: 'var(--color-primary-dark)',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                새로고침
              </button>
            )}
          </div>
          {isStale && (
            <div
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                {reconcileMessage ?? '최신 주문 정보를 확인하지 못했습니다.'}
              </p>
              <button
                type="button"
                className={UNSTYLED_BUTTON}
                onClick={reconcile}
                style={{
                  color: 'var(--color-primary-dark)',
                  fontSize: 'var(--font-size-sm)',
                  whiteSpace: 'nowrap',
                }}
              >
                다시 확인
              </button>
            </div>
          )}
          <OrderInfoSection order={order} productName={productName} groupConfig={groupConfig} />
          <OrderOperationsSection
            order={order}
            issues={issues}
            loading={operationsLoading}
            actionIssueId={actionIssueId}
            error={operationsError}
            onReload={reloadOperations}
            onAction={executeAction}
          />

          {actionError && (
            <p
              className={`${TEXT} text-center`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              {actionError}
            </p>
          )}

          {showPrepareForm && (
            <PrepareForm
              order={order}
              deliveryDate={deliveryDate}
              preparedAt={preparedAt}
              setPreparedAt={setPreparedAt}
              actionLoading={actionLoading}
              onConfirm={handlePrepare}
              onCancel={() => {
                setShowPrepareForm(false);
                setPreparedAt(null);
              }}
            />
          )}

          {isReadonly && order.status !== 'CANCELLED' && (
            <PostDeliveryRefundSection
              storeId={storeId}
              orderId={orderId}
              status={order.status}
              onRefunded={handleReconciled}
            />
          )}
        </div>
      </div>

      {/* 액션 버튼 — BottomNav 위에 고정 (D4) */}
      {showFooter && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(var(--bottom-nav-height) + env(safe-area-inset-bottom))',
            backgroundColor: 'var(--color-bg)',
            borderTop: '1px solid var(--color-border)',
            zIndex: 20,
          }}
        >
          <div className={`${CONTAINER} py-3`}>
            <div className="flex flex-col gap-2.5">
              {canPrepare && (
                <Button
                  onClick={() => setShowPrepareForm(true)}
                  disabled={actionLoading}
                  size="md"
                  className="w-full"
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    fontWeight: 'var(--fw-medium)',
                  }}
                >
                  준비 시작
                </Button>
              )}
              {canShipParcel && (
                <Button
                  onClick={handleShipParcel}
                  disabled={actionLoading}
                  size="md"
                  className="w-full"
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    fontWeight: 'var(--fw-medium)',
                  }}
                >
                  택배 발송 완료
                </Button>
              )}
              {actions.releaseHold && (
                <Button
                  onClick={() => {
                    setActionError(null);
                    setShowReleaseConfirm(true);
                  }}
                  disabled={actionLoading}
                  size="md"
                  className="w-full"
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    fontWeight: 'var(--fw-medium)',
                  }}
                >
                  재배송 준비로 돌리기
                </Button>
              )}
              {actions.hold && (
                <Button
                  onClick={() => {
                    setActionError(null);
                    setShowHoldModal(true);
                  }}
                  disabled={actionLoading}
                  size="md"
                  variant="outline-gray"
                  className="w-full"
                >
                  배송 보류
                </Button>
              )}
              {canCancel && (
                <Button
                  onClick={() => setShowCancelModal(true)}
                  disabled={actionLoading}
                  size="md"
                  variant="outline-destructive"
                  className="w-full"
                >
                  {isHeld ? '주문 취소·환불' : '강제 취소'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <CancelOrderModal
        opened={showCancelModal}
        cancelReason={cancelReason}
        setCancelReason={setCancelReason}
        actionLoading={actionLoading}
        actionError={actionError}
        title={isHeld ? '주문 취소·환불' : undefined}
        note={isHeld ? '결제 금액과 결제된 재배송비를 모두 환불해요.' : undefined}
        onClose={() => {
          setShowCancelModal(false);
          setCancelReason('');
          setActionError(null);
        }}
        onConfirm={handleCancel}
      />

      <DeliveryHoldModal
        opened={showHoldModal}
        actionLoading={actionLoading}
        actionError={actionError}
        onClose={() => {
          setShowHoldModal(false);
          setActionError(null);
        }}
        onSubmit={handleHold}
      />

      <ConfirmModal
        opened={showReleaseConfirm}
        title="재배송 준비로 돌리기"
        message={holdReleaseMessage(order)}
        confirmLabel="재배송 준비"
        confirmColor="brand"
        loading={actionLoading}
        onConfirm={handleReleaseHold}
        onClose={() => setShowReleaseConfirm(false)}
      />
    </PageShell>
  );
}
