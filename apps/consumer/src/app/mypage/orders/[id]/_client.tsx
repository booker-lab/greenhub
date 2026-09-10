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
import { getApiBaseUrl } from '@/lib/api-base-url';
import { readPortonePaymentConfiguration } from '@/lib/portone-config';
import {
  formatDateTime,
  classifyCommandFailure,
  hasAuthoritativeOrderStatus,
  isStaleOrderRead,
  readCommandConfirmation,
  type CommandOutcome,
  IDLE_COMMAND_OUTCOME,
  isNonEmptyString,
  isRecord,
  isSafeIdentifier,
  type OrderDetailView,
  readOrderDetail,
  readRedeliveryPaymentResponse,
} from './_detail';

const API_URL = getApiBaseUrl();
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
  const { data: session, status: sessionStatus } = useSession();
  const accessToken =
    sessionStatus === 'authenticated'
      ? session?.user?.accessToken
      : sessionStatus === 'unauthenticated'
        ? null
        : undefined;
  const { order, loading, error, status, refetch } = useOrderStatus(orderId, accessToken);
  const [cancelOutcome, setCancelOutcome] = useState<CommandOutcome>(IDLE_COMMAND_OUTCOME);
  const [reviewOutcome, setReviewOutcome] = useState<CommandOutcome>(IDLE_COMMAND_OUTCOME);
  const [redeliveryOutcome, setRedeliveryOutcome] = useState<CommandOutcome>(IDLE_COMMAND_OUTCOME);
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const detail = orderId ? readOrderDetail(order, orderId) : null;
  const isStaleRead = detail !== null && isStaleOrderRead(status);
  const isAuthoritativelyCancelled = hasAuthoritativeOrderStatus(detail, 'CANCELLED');
  const isAuthoritativelyReviewed = hasAuthoritativeOrderStatus(detail, 'REVIEWED');
  const cancelBusy = cancelOutcome.kind === 'executing' || cancelOutcome.kind === 'reconciling';
  const reviewBusy = reviewOutcome.kind === 'executing' || reviewOutcome.kind === 'reconciling';
  const redeliveryBusy =
    redeliveryOutcome.kind === 'executing' || redeliveryOutcome.kind === 'reconciling';

  async function handleRetry() {
    setRetrying(true);
    try {
      await refetch();
    } finally {
      setRetrying(false);
    }
  }

  async function handleCancel() {
    if (!session?.user?.accessToken || !detail?.canRequestCancellation) return;
    if (isAuthoritativelyCancelled) return;
    if (isStaleRead) {
      setActionError('최신 주문 상태를 확인하지 못했습니다. 최신 상태 확인 후 다시 시도해 주세요.');
      return;
    }
    const message = detail.isRoundOrder
      ? '주문 취소를 요청하시겠습니까?\n서버에서 회차 마감 전인지 다시 확인합니다.'
      : '공동구매 참여를 취소하시겠습니까?\n취소 후에는 되돌릴 수 없습니다.';
    if (!confirm(message)) return;
    setCancelOutcome({ kind: 'executing' });
    setActionError(null);
    try {
      let response: Response;
      try {
        response = await fetch(
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
      } catch {
        throw {
          kind: 'uncertain',
          message: '취소 요청 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = classifyCommandFailure({ httpStatus: response.status, hasResponse: true });
        const serverMessage =
          isRecord(body) && isNonEmptyString(body.message) ? body.message : null;
        if (failure === 'rejected') {
          throw {
            kind: 'rejected',
            message: serverMessage ?? '주문을 취소할 수 없습니다.',
          } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
        }
        throw {
          kind: 'uncertain',
          message: '취소 요청 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      if (!readCommandConfirmation(body, { orderId: detail.id, status: 'CANCELLED' })) {
        throw {
          kind: 'uncertain',
          message: '취소 확인 응답을 검증하지 못했습니다. 상태를 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      setCancelOutcome({ kind: 'reconciling' });
      const latestOrder = await refetch().catch(() => undefined);
      const latestDetail = latestOrder ? readOrderDetail(latestOrder, detail.id) : null;
      if (latestDetail && hasAuthoritativeOrderStatus(latestDetail, 'CANCELLED')) {
        setCancelOutcome({ kind: 'done' });
        return;
      }
      // Server confirmed the cancel, but the authoritative re-read did not
      // converge. This is not a cancel failure: keep the acknowledgement and
      // ask for an explicit status re-check instead of a blind retry.
      setCancelOutcome({ kind: 'reconcile-failed' });
    } catch (caught) {
      if (isRecord(caught) && typeof caught.message === 'string') {
        if (caught.kind === 'rejected') {
          setCancelOutcome({ kind: 'rejected', message: caught.message });
          setActionError(caught.message);
          return;
        }
        if (caught.kind === 'uncertain') {
          setCancelOutcome({ kind: 'uncertain', message: caught.message });
          setActionError(caught.message);
          return;
        }
      }
      if (caught instanceof TypeError) {
        const uncertainMessage =
          '취소 요청 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.';
        setCancelOutcome({ kind: 'uncertain', message: uncertainMessage });
        setActionError(uncertainMessage);
        return;
      }
      setCancelOutcome({ kind: 'uncertain', message: '취소 요청 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.' });
      setActionError(
        caught instanceof Error ? caught.message : '취소 요청 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.',
      );
    }
  }

  async function handleRedeliveryPayment() {
    const fee = detail?.deliveryHold?.redeliveryFee;
    if (
      !session?.user?.accessToken ||
      !detail?.redeliveryPayment.canPay ||
      detail.redeliveryPayment.requiresRecovery ||
      typeof fee !== 'number' ||
      fee <= 0
    ) {
      return;
    }
    if (isStaleRead) {
      setActionError('최신 주문 상태를 확인하지 못했습니다. 최신 상태 확인 후 다시 시도해 주세요.');
      return;
    }
    setRedeliveryOutcome({ kind: 'executing' });
    setActionError(null);
    try {
      let response: Response;
      try {
        response = await fetch(
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
      } catch {
        throw {
          kind: 'uncertain',
          message:
            '재배송비 결제 요청 결과를 확정할 수 없습니다. 중복 결제 전에 상태를 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = classifyCommandFailure({ httpStatus: response.status, hasResponse: true });
        const serverMessage =
          isRecord(body) && isNonEmptyString(body.message) ? body.message : null;
        if (failure === 'rejected') {
          throw {
            kind: 'rejected',
            message: serverMessage ?? '재배송비 결제를 시작할 수 없습니다.',
          } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
        }
        throw {
          kind: 'uncertain',
          message:
            '재배송비 결제 요청 결과를 확정할 수 없습니다. 중복 결제 전에 상태를 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      const payment = readRedeliveryPaymentResponse(body, {
        orderId: detail.id,
        storeId: detail.storeId,
        amount: fee,
      });
      if (payment.status === 'FAILED' || payment.status === 'REFUNDED') {
        throw {
          kind: 'rejected',
          message: '재배송비 결제 상태를 확인할 수 없습니다. 운영 확인이 필요합니다.',
        } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
      }
      if (payment.status === 'PENDING') {
        const configuration = readPortonePaymentConfiguration('kakaopay');
        const PortOne = await import('@portone/browser-sdk/v2');
        const result = await PortOne.requestPayment({
          storeId: configuration.portoneStoreId,
          paymentId: payment.paymentId,
          orderName: payment.name,
          totalAmount: payment.amount,
          currency: 'KRW',
          channelKey: configuration.channelKey,
          payMethod: 'EASY_PAY',
          easyPay: { easyPayProvider: configuration.easyPayProvider },
        });
        if (result && 'code' in result) {
          throw {
            kind: 'rejected',
            message:
              (isRecord(result) && isNonEmptyString(result.message)
                ? result.message
                : null) ?? '재배송비 결제가 취소되었습니다.',
          } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
        }
      }

      setRedeliveryOutcome({ kind: 'reconciling' });
      const latestOrder = await refetch().catch(() => undefined);
      const latestDetail = latestOrder ? readOrderDetail(latestOrder, detail.id) : null;
      if (!latestDetail?.redeliveryPayment.paid) {
        throw {
          kind: 'uncertain',
          message:
            '결제 요청은 접수되었지만 서버 확인 전입니다. 중복 결제 전에 잠시 후 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      setRedeliveryOutcome({ kind: 'done' });
    } catch (caught) {
      if (isRecord(caught) && typeof caught.message === 'string') {
        if (caught.kind === 'rejected') {
          setRedeliveryOutcome({ kind: 'rejected', message: caught.message });
          setActionError(caught.message);
          return;
        }
        if (caught.kind === 'uncertain') {
          setRedeliveryOutcome({ kind: 'uncertain', message: caught.message });
          setActionError(caught.message);
          return;
        }
      }
      if (caught instanceof TypeError) {
        const uncertainMessage =
          '재배송비 결제 요청 결과를 확정할 수 없습니다. 중복 결제 전에 상태를 다시 확인해 주세요.';
        setRedeliveryOutcome({ kind: 'uncertain', message: uncertainMessage });
        setActionError(uncertainMessage);
        return;
      }
      const fallbackMessage =
        caught instanceof Error ? caught.message : '재배송비 결제 중 오류가 발생했습니다.';
      setRedeliveryOutcome({ kind: 'uncertain', message: fallbackMessage });
      setActionError(fallbackMessage);
    }
  }

  async function handleConfirm() {
    if (!session?.user?.accessToken || !detail) return;
    if (isAuthoritativelyReviewed) return;
    if (isStaleRead) {
      setActionError('최신 주문 상태를 확인하지 못했습니다. 최신 상태 확인 후 다시 시도해 주세요.');
      return;
    }
    setReviewOutcome({ kind: 'executing' });
    setActionError(null);
    try {
      let response: Response;
      try {
        response = await fetch(
          `${API_URL}/stores/${encodeURIComponent(detail.storeId)}/orders/${detail.id}/review`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.user.accessToken}`,
            },
          },
        );
      } catch {
        throw {
          kind: 'uncertain',
          message: '구매 확정 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = classifyCommandFailure({ httpStatus: response.status, hasResponse: true });
        const serverMessage =
          isRecord(body) && isNonEmptyString(body.message) ? body.message : null;
        if (failure === 'rejected') {
          throw {
            kind: 'rejected',
            message: serverMessage ?? '구매 확정에 실패했습니다.',
          } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
        }
        throw {
          kind: 'uncertain',
          message: '구매 확정 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      if (!readCommandConfirmation(body, { orderId: detail.id, status: 'REVIEWED' })) {
        throw {
          kind: 'uncertain',
          message: '구매 확정 확인 응답을 검증하지 못했습니다. 상태를 다시 확인해 주세요.',
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      setReviewOutcome({ kind: 'reconciling' });
      const latestOrder = await refetch().catch(() => undefined);
      const latestDetail = latestOrder ? readOrderDetail(latestOrder, detail.id) : null;
      if (latestDetail && hasAuthoritativeOrderStatus(latestDetail, 'REVIEWED')) {
        setReviewOutcome({ kind: 'done' });
        return;
      }
      // Server confirmed the review, but the authoritative re-read did not
      // converge. This is not a review failure: keep the acknowledgement and
      // ask for an explicit status re-check instead of a blind retry.
      setReviewOutcome({ kind: 'reconcile-failed' });
    } catch (caught) {
      if (isRecord(caught) && typeof caught.message === 'string') {
        if (caught.kind === 'rejected') {
          setReviewOutcome({ kind: 'rejected', message: caught.message });
          setActionError(caught.message);
          return;
        }
        if (caught.kind === 'uncertain') {
          setReviewOutcome({ kind: 'uncertain', message: caught.message });
          setActionError(caught.message);
          return;
        }
      }
      if (caught instanceof TypeError) {
        const uncertainMessage = '구매 확정 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.';
        setReviewOutcome({ kind: 'uncertain', message: uncertainMessage });
        setActionError(uncertainMessage);
        return;
      }
      setReviewOutcome({ kind: 'uncertain', message: '구매 확정 결과를 확정할 수 없습니다. 상태를 다시 확인해 주세요.' });
      setActionError(
        caught instanceof Error ? caught.message : '구매 확정에 실패했습니다.',
      );
    }
  }

  if (sessionStatus === 'loading' || (loading && !detail && status === 'loading')) {
    return (
      <Box py={60} ta="center">
        <Text c="var(--color-text-disabled)">로딩 중...</Text>
      </Box>
    );
  }

  if (sessionStatus === 'unauthenticated' || status === 'auth') {
    return (
      <Container size="sm" px="md" py="lg">
        <Button variant="transparent" onClick={() => router.push('/mypage')} pl={0} mb="md">
          <ChevronLeft size={16} /> 뒤로
        </Button>
        <Stack align="center" gap="sm" py={40}>
          <Text ta="center" c="var(--color-danger)" size="sm">
            로그인이 필요하거나 이 주문을 볼 권한이 없습니다.
          </Text>
          <Group justify="center" gap="sm">
            <Button onClick={() => router.push('/login')} loading={retrying}>
              로그인
            </Button>
            <Button variant="outline" onClick={() => router.push('/mypage')}>
              주문 목록으로 돌아가기
            </Button>
          </Group>
        </Stack>
      </Container>
    );
  }

  if (!orderId || status === 'not-found') {
    return (
      <Container size="sm" px="md" py="lg">
        <Button variant="transparent" onClick={() => router.push('/mypage')} pl={0} mb="md">
          <ChevronLeft size={16} /> 뒤로
        </Button>
        <Stack align="center" gap="sm" py={40}>
          <Text ta="center" c="var(--color-text-secondary)" size="sm">
            존재하지 않는 주문입니다. 주문 번호를 확인하거나 주문 목록으로 돌아가 주세요.
          </Text>
          <Button variant="outline" onClick={() => router.push('/mypage')}>
            주문 목록으로 돌아가기
          </Button>
        </Stack>
      </Container>
    );
  }

  if (!detail && (status === 'network' || status === 'server')) {
    return (
      <Container size="sm" px="md" py="lg">
        <Button variant="transparent" onClick={() => router.push('/mypage')} pl={0} mb="md">
          <ChevronLeft size={16} /> 뒤로
        </Button>
        <Stack align="center" gap="sm" py={40}>
          <Text ta="center" c="var(--color-danger)" size="sm">
            {error ?? '주문 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
          </Text>
          <Group justify="center" gap="sm">
            <Button onClick={handleRetry} loading={retrying} disabled={retrying}>
              다시 시도
            </Button>
            <Button variant="outline" onClick={() => router.push('/mypage')}>
              주문 목록으로 돌아가기
            </Button>
          </Group>
        </Stack>
      </Container>
    );
  }

  if (!detail) {
    if (loading) {
      return (
        <Box py={60} ta="center">
          <Text c="var(--color-text-disabled)">로딩 중...</Text>
        </Box>
      );
    }
    return (
      <Container size="sm" px="md" py="lg">
        <Button variant="transparent" onClick={() => router.push('/mypage')} pl={0} mb="md">
          <ChevronLeft size={16} /> 뒤로
        </Button>
        <Stack align="center" gap="sm" py={40}>
          <Text ta="center" c="var(--color-danger)" size="sm">
            주문 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.
          </Text>
          <Group justify="center" gap="sm">
            <Button onClick={handleRetry} loading={retrying} disabled={retrying}>
              다시 시도
            </Button>
            <Button variant="outline" onClick={() => router.push('/mypage')}>
              주문 목록으로 돌아가기
            </Button>
          </Group>
        </Stack>
      </Container>
    );
  }

  const isCancelled = isAuthoritativelyCancelled || cancelOutcome.kind === 'done';
  const showCancelReconcileWarning =
    !isAuthoritativelyCancelled && cancelOutcome.kind === 'reconcile-failed';
  const showCancelCommand =
    detail.canRequestCancellation &&
    !isAuthoritativelyCancelled &&
    cancelOutcome.kind !== 'done';
  const isReviewable =
    !isAuthoritativelyReviewed &&
    (detail.status === 'DELIVERED' || detail.status === 'PICKED_UP') &&
    reviewOutcome.kind !== 'done';
  const showReviewConfirmed =
    isAuthoritativelyReviewed || reviewOutcome.kind === 'done';
  const showReviewSection = isReviewable || reviewOutcome.kind !== 'idle' || showReviewConfirmed;
  const showReviewReconcileWarning =
    !isAuthoritativelyReviewed && reviewOutcome.kind === 'reconcile-failed';
  const reviewLabel = showReviewConfirmed
    ? '구매 확정 완료'
    : reviewOutcome.kind === 'reconciling'
      ? '상태 확인 중...'
      : reviewOutcome.kind === 'reconcile-failed'
        ? '구매 확정 확인 필요'
        : reviewOutcome.kind === 'executing'
          ? '구매 확정 중...'
          : '구매 확정';
  const needsStatusRecheck =
    cancelOutcome.kind === 'uncertain' ||
    cancelOutcome.kind === 'reconcile-failed' ||
    reviewOutcome.kind === 'uncertain' ||
    reviewOutcome.kind === 'reconcile-failed' ||
    redeliveryOutcome.kind === 'uncertain';
  const showPickupCode =
    detail.pickupCode && ['HUB_ARRIVED', 'PICKED_UP', 'REVIEWED'].includes(detail.status);
  const steps = getTimelineSteps(detail);
  const currentStep =
    detail.status === 'REVIEWED' ? steps.length : Math.max(0, steps.indexOf(detail.status));
  const paymentIsDone = detail.redeliveryPayment.paid;

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      <Button variant="transparent" onClick={() => router.push('/mypage')} pl={0} mb="sm">
        <ChevronLeft size={16} /> 뒤로
      </Button>
      {(status === 'network' || status === 'server') && (
        <Alert color="yellow" variant="light" radius="md" mb="lg" title="최신 정보를 불러오지 못했습니다">
          <Stack gap={6}>
            <Text size="sm">{error ?? '최신 주문 정보를 확인하지 못했습니다.'}</Text>
            <Text size="sm">표시된 정보가 최신이 아닐 수 있습니다.</Text>
            <Text size="sm">
              최신 상태를 확인하기 전까지 취소·구매 확정·재배송비 결제를 시작할 수 없습니다.
            </Text>
            <Button
              mt="xs"
              variant="outline"
              loading={retrying}
              disabled={retrying}
              onClick={handleRetry}
            >
              다시 시도
            </Button>
          </Stack>
        </Alert>
      )}
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
            {detail.redeliveryPayment.required && (
              <Stack gap={6} mt="xs">
                {paymentIsDone && (
                  <Text size="sm" fw="var(--fw-bold)">
                    재배송비 결제가 완료되었습니다. 배송 재개를 기다리고 있습니다.
                  </Text>
                )}
                {!paymentIsDone && detail.redeliveryPayment.requiresRecovery && (
                  <Text size="sm" c="var(--color-danger)">
                    재배송비 결제 상태를 확인할 수 없습니다. 운영 확인이 필요합니다.
                  </Text>
                )}
                {!paymentIsDone &&
                  !detail.redeliveryPayment.requiresRecovery &&
                  detail.redeliveryPayment.canPay && (
                    <Button
                      mt="xs"
                      color="red"
                      loading={redeliveryBusy}
                      disabled={redeliveryBusy || isStaleRead}
                      onClick={handleRedeliveryPayment}
                    >
                      {redeliveryOutcome.kind === 'reconciling'
                        ? '서버 확인 중...'
                        : detail.redeliveryPayment.status === 'PENDING'
                          ? '재배송비 결제 계속하기'
                          : '재배송비 결제'}
                    </Button>
                  )}
              </Stack>
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

      {showCancelCommand && (
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
          {isStaleRead && (
            <Text size="sm" mb="sm">
              최신 주문 상태를 확인하지 못했습니다. 최신 상태 확인 후 다시 시도해 주세요.
            </Text>
          )}
          {cancelOutcome.kind === 'reconciling' && (
            <Text size="sm" mb="sm">
              서버에서 취소를 확인했습니다. 최신 주문 상태를 확인 중입니다.
            </Text>
          )}
          <Button
            fullWidth
            variant="outline"
            color="red"
            loading={cancelBusy}
            disabled={cancelBusy || isStaleRead || cancelOutcome.kind === 'reconcile-failed'}
            onClick={handleCancel}
          >
            {detail.isRoundOrder ? '주문 취소' : '공동구매 참여 취소'}
          </Button>
        </Alert>
      )}

      {showCancelReconcileWarning && (
        <Alert color="yellow" variant="light" radius="md" mb="lg" title="취소 확인됨 · 상태 재확인 필요">
          <Stack gap={6}>
            <Text size="sm">
              취소는 서버에서 확인됐지만 최신 주문 화면을 다시 불러오지 못했습니다. 취소 실패가
              아니므로 바로 다시 취소하지 말고 상태를 확인해 주세요.
            </Text>
            <Button
              mt="xs"
              variant="outline"
              loading={retrying}
              disabled={retrying}
              onClick={handleRetry}
            >
              다시 시도
            </Button>
          </Stack>
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
          <Stack gap={6}>
            <Text size="sm">{actionError}</Text>
            {needsStatusRecheck && (
              <Text size="sm">
                중복 요청 전에 다시 시도로 현재 상태를 확인해 주세요.
              </Text>
            )}
            {needsStatusRecheck && (
              <Button
                mt="xs"
                variant="outline"
                loading={retrying}
                disabled={retrying}
                onClick={handleRetry}
              >
                상태 다시 확인
              </Button>
            )}
          </Stack>
        </Alert>
      )}

      {showReviewSection && (
        <Stack gap={6} mb="lg">
          <Button
            fullWidth
            radius="md"
            disabled={reviewBusy || showReviewConfirmed || showReviewReconcileWarning || isStaleRead}
            loading={reviewBusy}
            variant={showReviewConfirmed ? 'outline' : 'filled'}
            onClick={handleConfirm}
          >
            {reviewLabel}
          </Button>
          {isStaleRead && isReviewable && (
            <Text size="sm" c="var(--color-text-secondary)" ta="center">
              최신 주문 상태를 확인하지 못했습니다. 최신 상태 확인 후 다시 시도해 주세요.
            </Text>
          )}
          {reviewOutcome.kind === 'reconciling' && (
            <Text size="sm" c="var(--color-text-secondary)" ta="center">
              서버에서 구매 확정을 확인했습니다. 최신 주문 상태를 확인 중입니다.
            </Text>
          )}
        </Stack>
      )}

      {showReviewReconcileWarning && (
        <Alert color="yellow" variant="light" radius="md" mb="lg" title="구매 확정 확인됨 · 상태 재확인 필요">
          <Stack gap={6}>
            <Text size="sm">
              구매 확정은 서버에서 확인됐지만 최신 주문 화면을 다시 불러오지 못했습니다. 확정
              실패가 아니므로 바로 다시 확정하지 말고 상태를 확인해 주세요.
            </Text>
            <Button
              mt="xs"
              variant="outline"
              loading={retrying}
              disabled={retrying}
              onClick={handleRetry}
            >
              다시 시도
            </Button>
          </Stack>
        </Alert>
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
