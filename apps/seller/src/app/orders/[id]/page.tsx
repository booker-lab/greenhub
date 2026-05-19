'use client';

import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Box, Button, Container, Stack, Text, UnstyledButton } from '@mantine/core';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { CANCELLABLE_STATUSES, READONLY_STATUSES } from './_lib';
import { useOrderDetail } from './_hooks/useOrderDetail';
import { useOrderDetailActions } from './_hooks/useOrderDetailActions';
import { CancelOrderModal } from './_components/CancelOrderModal';
import { OrderInfoSection } from './_components/OrderInfoSection';
import { PrepareForm } from './_components/PrepareForm';

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;

  const { order, productName, groupConfig, loading } = useOrderDetail(orderId);
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
    handlePrepare,
    handleCancel,
  } = useOrderDetailActions(storeId, orderId);

  if (loading) {
    return <LoadingState fullPage />;
  }

  if (!order) {
    return (
      <Box
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--color-surface-muted)',
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
            <UnstyledButton
              onClick={() => router.back()}
              style={{
                color: 'var(--color-primary)',
                textDecoration: 'underline',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              돌아가기
            </UnstyledButton>
          }
        />
      </Box>
    );
  }

  const isReadonly = READONLY_STATUSES.includes(order.status);
  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED';
  const canCancel = CANCELLABLE_STATUSES.includes(order.status);
  const showFooter = !isReadonly && !showPrepareForm && (canPrepare || canCancel);
  const deliveryDate =
    order.saleType === 'normal'
      ? order.requestedDeliveryDate
      : (groupConfig?.groupDeliveryDate?.slice(0, 10) ?? null);

  return (
    <PageShell paddingBottom={showFooter ? 200 : 96}>
      <PageHeader title="주문 상세" onBack={() => router.back()} />

      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          <OrderInfoSection order={order} productName={productName} groupConfig={groupConfig} />

          {actionError && (
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              ta="center"
            >
              {actionError}
            </Text>
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
            <Text
              ta="center"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              py="xs"
            >
              발송 이후 단계입니다. 취소가 필요한 경우 소비자 반품 신청을 통해 처리됩니다.
            </Text>
          )}
        </Stack>
      </Container>

      {/* 액션 버튼 — BottomNav 위에 고정 (D4) */}
      {showFooter && (
        <Box
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
          <Container size="sm" px="md" py="sm">
            <Stack gap="xs">
              {canPrepare && (
                <Button
                  onClick={() => setShowPrepareForm(true)}
                  disabled={actionLoading}
                  fullWidth
                  size="lg"
                  radius="xl"
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    fontWeight: 'var(--fw-medium)',
                  }}
                >
                  준비 시작
                </Button>
              )}
              {canCancel && (
                <Button
                  onClick={() => setShowCancelModal(true)}
                  disabled={actionLoading}
                  fullWidth
                  size="lg"
                  radius="xl"
                  variant="outline"
                  color="red"
                >
                  강제 취소
                </Button>
              )}
            </Stack>
          </Container>
        </Box>
      )}

      <CancelOrderModal
        opened={showCancelModal}
        cancelReason={cancelReason}
        setCancelReason={setCancelReason}
        actionLoading={actionLoading}
        actionError={actionError}
        onClose={() => {
          setShowCancelModal(false);
          setCancelReason('');
          setActionError(null);
        }}
        onConfirm={handleCancel}
      />
    </PageShell>
  );
}
