'use client';

import type { Order, OrderStatus } from '@greenhub/shared';
import {
  Alert,
  Box,
  Button,
  Container,
  Divider,
  Group,
  Paper,
  Stack,
  Stepper,
  Text,
  Title,
} from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { use, useState } from 'react';
import { useOrderStatus } from '@/hooks/useOrderStatus';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '구매 확정',
};

function getTimelineSteps(order: Order): OrderStatus[] {
  if (order.saleType === 'group') {
    return ['RECRUITING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
  }
  if (order.deliveryMethod === 'hub') {
    return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP'];
  }
  return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
}

function getCurrentStepIndex(steps: OrderStatus[], status: OrderStatus): number {
  if (status === 'REVIEWED') return steps.length;
  return steps.indexOf(status);
}

function PickupCodeCard({ code, address }: { code: string; address: string }) {
  return (
    <Paper
      radius="md"
      p="lg"
      mb="md"
      ta="center"
      withBorder
      style={{ borderColor: 'var(--color-primary)', borderWidth: 2 }}
    >
      <Text
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-primary)',
        }}
        mb="xs"
      >
        픽업 코드
      </Text>
      <Text
        ta="center"
        mb="xs"
        style={{
          fontSize: 36,
          letterSpacing: 8,
          fontFamily: 'monospace',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
        }}
      >
        {code}
      </Text>
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
        수령 장소: {address}
      </Text>
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mt={4}>
        코드를 제시하고 수령하세요
      </Text>
    </Paper>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const { order, loading, error } = useOrderStatus(orderId, session?.user?.accessToken);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelDone, setCancelDone] = useState(false);

  async function handleCancel() {
    if (!session?.user?.accessToken || !order) return;
    if (!confirm('공동구매 참여를 취소하시겠습니까?\n취소 후에는 되돌릴 수 없습니다.')) return;
    setCancelling(true);
    try {
      const res = await fetch(`${API_URL}/stores/${order.storeId}/orders/${orderId}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.user.accessToken}`,
        },
      });
      if (res.ok) setCancelDone(true);
    } finally {
      setCancelling(false);
    }
  }

  async function handleConfirm() {
    if (!session?.user?.accessToken || !order) return;
    setConfirming(true);
    try {
      const res = await fetch(`${API_URL}/stores/${order.storeId}/orders/${orderId}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.user.accessToken}`,
        },
      });
      if (res.ok) setConfirmed(true);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <Box py={60} ta="center">
        <Text style={{ color: 'var(--color-text-disabled)' }}>로딩 중...</Text>
      </Box>
    );
  }

  if (error || !order) {
    return (
      <Container size="sm" px="md" py="lg">
        <Button
          variant="transparent"
          style={{ color: 'var(--color-text-secondary)' }}
          onClick={() => router.push('/mypage')}
          pl={0}
          mb="md"
        >
          <ChevronLeft size={16} /> 뒤로
        </Button>
        <Text
          ta="center"
          style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}
          py={40}
        >
          주문 정보를 불러올 수 없습니다.
        </Text>
      </Container>
    );
  }

  const steps = getTimelineSteps(order);
  const isCancelled = order.status === 'CANCELLED';
  const isReviewable =
    !confirmed &&
    order.status !== 'REVIEWED' &&
    (order.status === 'DELIVERED' || order.status === 'PICKED_UP');
  const currentIdx = getCurrentStepIndex(steps, order.status);
  const pickupCode =
    order.pickupCode &&
    (order.status === 'HUB_ARRIVED' || order.status === 'PICKED_UP' || order.status === 'REVIEWED')
      ? order.pickupCode
      : null;

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      <Button
        variant="transparent"
        style={{ color: 'var(--color-text-secondary)' }}
        onClick={() => router.push('/mypage')}
        pl={0}
        mb="sm"
      >
        <ChevronLeft size={16} /> 뒤로
      </Button>
      <Title order={3} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }} mb={4}>
        주문 상세
      </Title>
      <Text
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        mb="lg"
      >
        주문번호: {order.orderNumber ?? orderId}
      </Text>

      <Paper withBorder radius="md" p="md" mb="lg">
        <Stack gap={8}>
          <Group justify="space-between">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              배송 방식
            </Text>
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              {order.deliveryMethod === 'hub'
                ? '거점 픽업'
                : order.deliveryMethod === 'parcel'
                  ? '택배'
                  : '직배송'}
              {order.saleType === 'group' && ' (공동구매)'}
            </Text>
          </Group>
          {order.deliveryAddress?.address && (
            <Group justify="space-between" align="flex-start">
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                }}
              >
                배송지
              </Text>
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--color-text)',
                  flex: 1,
                  marginLeft: 12,
                }}
                ta="right"
              >
                {order.deliveryAddress.address} {order.deliveryAddress.addressDetail}
              </Text>
            </Group>
          )}
          {order.requestedDeliveryDate && (
            <Group justify="space-between">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                배송 희망일
              </Text>
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text)',
                }}
              >
                {order.requestedDeliveryDate}
              </Text>
            </Group>
          )}
          {order.deliveryMethod === 'parcel' && order.courierCompany && (
            <Group justify="space-between">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                택배사
              </Text>
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text)',
                }}
              >
                {order.courierCompany}
              </Text>
            </Group>
          )}
          {order.deliveryMethod === 'parcel' && order.trackingNumber && (
            <Group justify="space-between">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                운송장번호
              </Text>
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text)',
                }}
              >
                {order.trackingNumber}
              </Text>
            </Group>
          )}
          <Divider />
          <Group justify="space-between">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              결제 금액
            </Text>
            <Text
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              {order.totalAmount.toLocaleString('ko-KR')}원
            </Text>
          </Group>
        </Stack>
      </Paper>

      {order.status === 'RECRUITING' && !cancelDone && (
        <Alert color="blue" variant="light" radius="md" mb="lg" title="공동구매 모집 중">
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
            mb="xs"
          >
            모집 마감일까지 참여 인원이 충족되면 주문이 확정됩니다. 확정 이후에는 취소·환불이
            불가합니다.
          </Text>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            mb="md"
          >
            모집 마감 후 인원 미달 시 자동으로 취소되고 전액 환불됩니다.
          </Text>
          <Button
            fullWidth
            radius="md"
            size="sm"
            variant="outline"
            color="red"
            loading={cancelling}
            disabled={cancelling}
            onClick={handleCancel}
          >
            공동구매 참여 취소
          </Button>
        </Alert>
      )}

      {(isCancelled || cancelDone) && (
        <Alert color="red" variant="light" radius="md" mb="lg" ta="center">
          <Text style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-danger)' }} mb={4}>
            주문이 취소되었습니다
          </Text>
          {order.cancelReason && (
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              사유: {order.cancelReason}
            </Text>
          )}
        </Alert>
      )}

      {pickupCode && (
        <PickupCodeCard code={pickupCode} address={order.deliveryAddress?.address ?? ''} />
      )}

      {(isReviewable || confirmed) && (
        <Button
          fullWidth
          radius="md"
          size="md"
          mb="lg"
          disabled={confirming || confirmed}
          loading={confirming}
          variant={confirmed ? 'outline' : 'filled'}
          color="brand"
          onClick={handleConfirm}
        >
          {confirmed ? '✓ 구매 확정 완료' : '구매 확정'}
        </Button>
      )}

      {!isCancelled && !cancelDone && (
        <Box>
          <Text
            style={{
              fontWeight: 'var(--fw-bold)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text)',
            }}
            mb="md"
          >
            배송 현황
          </Text>
          <Stepper
            active={currentIdx}
            color="brand"
            size="sm"
            orientation="vertical"
            styles={{
              stepLabel: { fontWeight: 'var(--fw-bold)' },
              stepDescription: { fontSize: 12 },
            }}
          >
            {steps.map((stepStatus) => {
              const label =
                stepStatus === 'DELIVERED' && order.status === 'REVIEWED'
                  ? '배송 완료 · 구매 확정'
                  : (STATUS_LABELS[stepStatus] ?? stepStatus);
              return <Stepper.Step key={stepStatus} label={label} />;
            })}
          </Stepper>
        </Box>
      )}
    </Container>
  );
}
