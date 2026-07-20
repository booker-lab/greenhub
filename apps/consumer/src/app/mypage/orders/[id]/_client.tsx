'use client';

import type { OrderStatus } from '@greenhub/shared';
import {
  Alert,
  Box,
  Button,
  Container,
  Divider,
  Group,
  Image,
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
import {
  formatDateTime,
  isNonEmptyString,
  isRecord,
  isSafeIdentifier,
  type OrderDetailView,
  readOrderDetail,
  readRedeliveryPaymentResponse,
} from './_detail';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '주문 접수',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  DELIVERY_HELD: '배송 보류',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '구매 확정',
};

function readPaymentConfiguration() {
  const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
  const channelKey = process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY;
  if (!isNonEmptyString(storeId) || !isNonEmptyString(channelKey)) {
    throw new Error('결제 설정을 확인할 수 없습니다.');
  }
  return { storeId, channelKey };
}

function getTimelineSteps(order: OrderDetailView): OrderStatus[] {
  if (order.saleType === 'group') {
    return ['RECRUITING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
  }
  if (order.deliveryMethod === 'hub') {
    return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP'];
  }
  return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawOrderId } = use(params);
  const orderId = isSafeIdentifier(rawOrderId) ? rawOrderId : null;
  const router = useRouter();
  const { data: session } = useSession();
  const { order, loading, error } = useOrderStatus(orderId, session?.user?.accessToken);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelDone, setCancelDone] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const detail = !loading && !error && orderId ? readOrderDetail(order, orderId) : null;

  async function handleCancel() {
    if (!session?.user?.accessToken || !detail?.canRequestCancellation) return;
    const message = detail.isRoundOrder
      ? '주문 취소를 요청하시겠습니까?\n서버에서 회차 마감 전인지 다시 확인합니다.'
      : '공동구매 참여를 취소하시겠습니까?\n취소 후에는 되돌릴 수 없습니다.';
    if (!confirm(message)) return;
    setCancelling(true);
    setActionError(null);
    try {
      const response = await fetch(
        `${API_URL}/stores/${encodeURIComponent(detail.storeId)}/orders/${detail.id}/cancel`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.user.accessToken}`,
          },
          body: JSON.stringify({ reason: '고객 요청' }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !isRecord(body) ||
        body.orderId !== detail.id ||
        body.status !== 'CANCELLED'
      ) {
        throw new Error(
          isRecord(body) && isNonEmptyString(body.message)
            ? body.message
            : '주문을 취소할 수 없습니다.',
        );
      }
      setCancelDone(true);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '주문 취소에 실패했습니다.');
    } finally {
      setCancelling(false);
    }
  }

  async function handleRedeliveryPayment() {
    const fee = detail?.deliveryHold?.redeliveryFee;
    if (!session?.user?.accessToken || !detail?.canPayRedeliveryFee || typeof fee !== 'number') {
      return;
    }
    setPaying(true);
    setActionError(null);
    try {
      const response = await fetch(
        `${API_URL}/stores/${encodeURIComponent(detail.storeId)}/orders/${detail.id}/redelivery-fee`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.user.accessToken}`,
          },
          body: JSON.stringify({ idempotencyKey: `redelivery:${detail.id}:first` }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          isRecord(body) && isNonEmptyString(body.message)
            ? body.message
            : '재배송비 결제를 시작할 수 없습니다.',
        );
      }
      const payment = readRedeliveryPaymentResponse(body, {
        orderId: detail.id,
        storeId: detail.storeId,
        amount: fee,
      });
      const configuration = readPaymentConfiguration();
      const PortOne = await import('@portone/browser-sdk/v2');
      const result = await PortOne.requestPayment({
        storeId: configuration.storeId,
        paymentId: payment.paymentId,
        orderName: payment.name,
        totalAmount: payment.amount,
        currency: 'KRW',
        channelKey: configuration.channelKey,
        payMethod: 'EASY_PAY',
        easyPay: { easyPayProvider: 'KAKAOPAY' },
      });
      if (result && 'code' in result) {
        throw new Error(result.message ?? '재배송비 결제가 취소되었습니다.');
      }
      setPaymentDone(true);
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : '재배송비 결제 중 오류가 발생했습니다.',
      );
    } finally {
      setPaying(false);
    }
  }

  async function handleConfirm() {
    if (!session?.user?.accessToken || !detail) return;
    setConfirming(true);
    setActionError(null);
    try {
      const response = await fetch(
        `${API_URL}/stores/${encodeURIComponent(detail.storeId)}/orders/${detail.id}/review`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.user.accessToken}`,
          },
        },
      );
      if (!response.ok) throw new Error('구매 확정에 실패했습니다.');
      setConfirmed(true);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '구매 확정에 실패했습니다.');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <Box py={60} ta="center">
        <Text c="var(--color-text-disabled)">로딩 중...</Text>
      </Box>
    );
  }

  if (error || !detail || !orderId) {
    return (
      <Container size="sm" px="md" py="lg">
        <Button variant="transparent" onClick={() => router.push('/mypage')} pl={0} mb="md">
          <ChevronLeft size={16} /> 뒤로
        </Button>
        <Text ta="center" c="var(--color-danger)" size="sm" py={40}>
          주문 정보를 확인할 수 없습니다.
        </Text>
      </Container>
    );
  }

  const isCancelled = detail.status === 'CANCELLED' || cancelDone;
  const isReviewable =
    !confirmed && (detail.status === 'DELIVERED' || detail.status === 'PICKED_UP');
  const showPickupCode =
    detail.pickupCode && ['HUB_ARRIVED', 'PICKED_UP', 'REVIEWED'].includes(detail.status);
  const steps = getTimelineSteps(detail);
  const currentStep =
    detail.status === 'REVIEWED' ? steps.length : Math.max(0, steps.indexOf(detail.status));

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      <Button variant="transparent" onClick={() => router.push('/mypage')} pl={0} mb="sm">
        <ChevronLeft size={16} /> 뒤로
      </Button>
      <Group justify="space-between" align="flex-start" mb="lg">
        <Box>
          <Title order={3}>주문 상세</Title>
          <Text size="sm" c="var(--color-text-disabled)">
            주문번호: {detail.orderNumber}
          </Text>
        </Box>
        <Text fw="var(--fw-bold)" c={detail.status === 'DELIVERY_HELD' ? 'red' : 'brand'}>
          {STATUS_LABELS[detail.status]}
        </Text>
      </Group>

      <Paper withBorder radius="md" p="md" mb="lg">
        <Group justify="space-between" mb="sm">
          <Text fw="var(--fw-bold)">주문 상품</Text>
          {detail.items.length > 0 && (
            <Text size="sm" c="var(--color-text-secondary)">
              총 {detail.items.length}개 상품 ·{' '}
              {detail.items.reduce((sum, item) => sum + item.quantity, 0)}개
            </Text>
          )}
        </Group>
        <Stack gap="xs">
          {detail.items.map((item) => (
            <Group key={item.id} justify="space-between" align="flex-start">
              <Text size="sm">
                {item.productName} × {item.quantity}
              </Text>
              <Text size="sm">{item.subtotalAmount.toLocaleString('ko-KR')}원</Text>
            </Group>
          ))}
          <Divider />
          {detail.deliveryFee > 0 && (
            <Group justify="space-between">
              <Text size="sm" c="var(--color-text-secondary)">
                배송비
              </Text>
              <Text size="sm">{detail.deliveryFee.toLocaleString('ko-KR')}원</Text>
            </Group>
          )}
          <Group justify="space-between">
            <Text fw="var(--fw-bold)">결제 금액</Text>
            <Text fw="var(--fw-bold)">{detail.totalAmount.toLocaleString('ko-KR')}원</Text>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder radius="md" p="md" mb="lg">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" c="var(--color-text-secondary)">
              배송 방식
            </Text>
            <Text size="sm" fw="var(--fw-bold)">
              {detail.deliveryMethod === 'hub'
                ? '거점 픽업'
                : detail.deliveryMethod === 'parcel'
                  ? '택배'
                  : '직배송'}
              {detail.saleType === 'group' && ' (공동구매)'}
            </Text>
          </Group>
          {detail.deliveryAddress && (
            <Group justify="space-between" align="flex-start">
              <Text size="sm" c="var(--color-text-secondary)">
                배송지
              </Text>
              <Text size="sm" ta="right">
                {detail.deliveryAddress.address} {detail.deliveryAddress.addressDetail}
              </Text>
            </Group>
          )}
          {detail.requestedDeliveryDate && (
            <Group justify="space-between">
              <Text size="sm" c="var(--color-text-secondary)">
                배송 예정일
              </Text>
              <Text size="sm">{detail.requestedDeliveryDate.slice(0, 10)}</Text>
            </Group>
          )}
        </Stack>
      </Paper>

      {detail.deliveryHold && (
        <Alert color="red" variant="light" radius="md" mb="lg" title="배송 보류">
          <Stack gap={6}>
            <Text size="sm">{detail.deliveryHold.reasonMessage}</Text>
            <Text size="sm">
              고객 책임: {detail.deliveryHold.customerResponsible ? '해당' : '없음'}
            </Text>
            {detail.deliveryHold.redeliveryFee !== null && (
              <Text size="sm">
                재배송비: {detail.deliveryHold.redeliveryFee.toLocaleString('ko-KR')}원
              </Text>
            )}
            {detail.deliveryHold.nextContactAt && (
              <Text size="sm">다음 연락: {formatDateTime(detail.deliveryHold.nextContactAt)}</Text>
            )}
            {detail.deliveryHold.nextDeliveryAt && (
              <Text size="sm">다음 배송: {formatDateTime(detail.deliveryHold.nextDeliveryAt)}</Text>
            )}
            {detail.canPayRedeliveryFee && (
              <Button
                mt="xs"
                color="red"
                loading={paying}
                disabled={paying || paymentDone}
                onClick={handleRedeliveryPayment}
              >
                {paymentDone ? '재배송비 결제 반영 중' : '재배송비 결제'}
              </Button>
            )}
          </Stack>
        </Alert>
      )}

      {detail.deliveryPhotoUrl && (
        <Paper withBorder radius="md" p="md" mb="lg">
          <Text fw="var(--fw-bold)" size="sm" mb="sm">
            배송 완료 사진
          </Text>
          <Image
            src={detail.deliveryPhotoUrl}
            alt="배송 완료 사진"
            radius="md"
            fit="cover"
            mah={420}
          />
        </Paper>
      )}

      {showPickupCode && (
        <Paper withBorder radius="md" p="lg" mb="lg" ta="center">
          <Text size="sm" fw="var(--fw-bold)" c="brand">
            픽업 코드
          </Text>
          <Text fz={36} ff="monospace" fw="var(--fw-bold)" lts={8}>
            {detail.pickupCode}
          </Text>
          <Text size="sm" c="var(--color-text-secondary)">
            코드를 제시하고 수령하세요
          </Text>
        </Paper>
      )}

      {detail.canRequestCancellation && !cancelDone && (
        <Alert
          color="blue"
          variant="light"
          radius="md"
          mb="lg"
          title={detail.isRoundOrder ? '주문 마감 전 취소' : '공동구매 모집 중'}
        >
          <Text size="sm" mb="sm">
            {detail.isRoundOrder
              ? '취소 요청 시 서버가 회차 마감 여부를 다시 확인하고 환불과 주문 한도 반환을 처리합니다.'
              : '모집 중인 공동구매 참여를 취소할 수 있습니다.'}
          </Text>
          <Button
            fullWidth
            variant="outline"
            color="red"
            loading={cancelling}
            disabled={cancelling}
            onClick={handleCancel}
          >
            {detail.isRoundOrder ? '주문 취소' : '공동구매 참여 취소'}
          </Button>
        </Alert>
      )}

      {isCancelled && (
        <Alert color="red" variant="light" radius="md" mb="lg" ta="center">
          <Text fw="var(--fw-bold)">주문이 취소되었습니다</Text>
          {detail.cancelReason && <Text size="sm">사유: {detail.cancelReason}</Text>}
        </Alert>
      )}

      {actionError && (
        <Alert color="red" variant="light" radius="md" mb="lg">
          {actionError}
        </Alert>
      )}

      {(isReviewable || confirmed) && (
        <Button
          fullWidth
          radius="md"
          mb="lg"
          disabled={confirming || confirmed}
          loading={confirming}
          variant={confirmed ? 'outline' : 'filled'}
          onClick={handleConfirm}
        >
          {confirmed ? '구매 확정 완료' : '구매 확정'}
        </Button>
      )}

      {!isCancelled && detail.status !== 'DELIVERY_HELD' && (
        <Box>
          <Text fw="var(--fw-bold)" size="sm" mb="md">
            배송 현황
          </Text>
          <Stepper active={currentStep} color="brand" size="sm" orientation="vertical">
            {steps.map((stepStatus) => (
              <Stepper.Step key={stepStatus} label={STATUS_LABELS[stepStatus] ?? stepStatus} />
            ))}
          </Stepper>
        </Box>
      )}
    </Container>
  );
}
