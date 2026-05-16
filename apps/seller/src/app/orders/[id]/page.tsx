'use client';

import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Box, Button, Container, Stack, Text, UnstyledButton } from '@mantine/core';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { LoadingState } from '@/components/StateViews';
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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          주문을 찾을 수 없습니다
        </Text>
        <UnstyledButton
          onClick={() => router.back()}
          style={{ color: 'var(--color-primary)', textDecoration: 'underline', fontSize: 14 }}
        >
          돌아가기
        </UnstyledButton>
      </Box>
    );
  }

  const isReadonly = READONLY_STATUSES.includes(order.status);
  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED';
  const canCancel = CANCELLABLE_STATUSES.includes(order.status);
  const deliveryDate =
    order.saleType === 'normal'
      ? order.requestedDeliveryDate
      : (groupConfig?.groupDeliveryDate?.slice(0, 10) ?? null);

  return (
    <PageShell paddingBottom={96}>
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

          {!isReadonly && !showPrepareForm && (
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
