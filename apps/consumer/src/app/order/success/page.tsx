'use client';

import type { OrderStatus } from '@greenhub/shared';
import { Button, Container, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Suspense, useEffect } from 'react';
import { useOrderStatus } from '@/hooks/useOrderStatus';

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중...',
  RECRUITING: '공동구매 모집 중',
  ACCEPTED: '주문 접수 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '리뷰 완료',
};

const ORDER_STATUSES = new Set<OrderStatus>([
  'PENDING',
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'DELIVERY_HELD',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'REVIEWED',
]);
const SUCCESS_STATUSES = new Set<OrderStatus>(['ACCEPTED', 'RECRUITING']);
const MAX_IDENTIFIER_LENGTH = 128;
const UNSAFE_IDENTIFIER_CHARACTERS = '/?#\\';
const ROUND_ORDER_NUMBER_PATTERN = /^\d{8}-\d{6}$/;

interface SuccessOrderItem {
  id: string;
  productName: string;
  quantity: number;
  subtotalAmount: number;
}

interface SuccessOrderView {
  orderNumber: string;
  isRoundOrder: boolean;
  items: SuccessOrderItem[];
  totalQuantity: number;
  totalAmount: number;
}

type ValidOrderRecord = Record<string, unknown> & {
  id: string;
  status: OrderStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeIdentifier(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) {
    return false;
  }
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || UNSAFE_IDENTIFIER_CHARACTERS.includes(character);
  });
}

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseOrderId(values: string[]): string | null {
  return values.length === 1 && isSafeIdentifier(values[0]) ? values[0] : null;
}

function readOrderRecord(value: unknown, requestedOrderId: string): ValidOrderRecord | null {
  if (
    !isRecord(value) ||
    !isSafeIdentifier(value.id) ||
    value.id !== requestedOrderId ||
    typeof value.status !== 'string' ||
    !ORDER_STATUSES.has(value.status as OrderStatus)
  ) {
    return null;
  }
  return value as ValidOrderRecord;
}

function readRoundOrderItems(value: unknown): SuccessOrderItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const items: SuccessOrderItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isSafeIdentifier(item.roundItemId) ||
      !isSafeIdentifier(item.productId) ||
      !isNonEmptyString(item.productName) ||
      !isMoney(item.unitPrice) ||
      !isPositiveQuantity(item.quantity) ||
      !isMoney(item.subtotalAmount)
    ) {
      return null;
    }
    const expectedSubtotal = item.unitPrice * item.quantity;
    if (!Number.isSafeInteger(expectedSubtotal) || item.subtotalAmount !== expectedSubtotal) {
      return null;
    }
    items.push({
      id: item.roundItemId,
      productName: item.productName,
      quantity: item.quantity,
      subtotalAmount: item.subtotalAmount,
    });
  }
  return new Set(items.map((item) => item.id)).size === items.length ? items : null;
}

function readSuccessOrder(value: unknown, requestedOrderId: string): SuccessOrderView | null {
  const order = readOrderRecord(value, requestedOrderId);
  if (!order || !SUCCESS_STATUSES.has(order.status)) return null;

  const hasRoundIdentity =
    order.schemaVersion === 2 || (order.roundId !== undefined && order.roundId !== null);
  if (!hasRoundIdentity) {
    if (order.orderNumber !== undefined && !isSafeIdentifier(order.orderNumber)) return null;
    return {
      orderNumber: order.orderNumber ?? requestedOrderId,
      isRoundOrder: false,
      items: [],
      totalQuantity: 0,
      totalAmount: 0,
    };
  }

  if (
    order.schemaVersion !== 2 ||
    !isSafeIdentifier(order.roundId) ||
    typeof order.orderNumber !== 'string' ||
    !ROUND_ORDER_NUMBER_PATTERN.test(order.orderNumber) ||
    order.saleType !== 'normal' ||
    order.deliveryMethod !== 'direct' ||
    order.deliveryFee !== 0 ||
    !isMoney(order.totalAmount)
  ) {
    return null;
  }

  const items = readRoundOrderItems(order.orderItems);
  if (!items) return null;
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.subtotalAmount, 0);
  if (
    !Number.isSafeInteger(totalQuantity) ||
    !Number.isSafeInteger(totalAmount) ||
    order.totalAmount !== totalAmount
  ) {
    return null;
  }

  return {
    orderNumber: order.orderNumber,
    isRoundOrder: true,
    items,
    totalQuantity,
    totalAmount,
  };
}

function ErrorState({ message, onHome }: { message: string; onHome: () => void }) {
  return (
    <>
      <Text style={{ fontSize: 56 }}>⚠️</Text>
      <Title order={2}>주문 정보를 불러올 수 없습니다</Title>
      <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}>
        {message}
      </Text>
      <Button color="brand" radius="md" mt="md" onClick={onHome}>
        홈으로
      </Button>
    </>
  );
}

function OrderSuccessContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const orderId = parseOrderId(params.getAll('orderId'));
  const { order, loading, error } = useOrderStatus(orderId, session?.user?.accessToken);
  const validOrder = orderId ? readOrderRecord(order, orderId) : null;
  const successOrder = !loading && !error && orderId ? readSuccessOrder(order, orderId) : null;

  useEffect(() => {
    if (!orderId) router.replace('/');
  }, [orderId, router]);

  useEffect(() => {
    if (validOrder?.status !== 'CANCELLED') return;
    const timer = setTimeout(() => router.replace('/'), 4000);
    return () => clearTimeout(timer);
  }, [router, validOrder?.status]);

  const isPending = !error && validOrder?.status === 'PENDING';
  const isCancelled = !error && validOrder?.status === 'CANCELLED';
  const responseError =
    !loading &&
    !error &&
    !!orderId &&
    (!order ||
      !validOrder ||
      (validOrder && SUCCESS_STATUSES.has(validOrder.status) && !successOrder));
  const errorMessage = !orderId
    ? '올바른 주문번호가 필요합니다.'
    : error ||
      (responseError ? '주문 응답을 확인할 수 없습니다. 주문 내역에서 다시 확인해 주세요.' : null);

  return (
    <Container size="sm" px="md" py={60}>
      <Stack align="center" gap="xs">
        {!!orderId && !errorMessage && (loading || isPending) && (
          <>
            <Text size="xl" style={{ fontSize: 56 }}>
              ⏳
            </Text>
            <Title order={2}>결제 확인 중...</Title>
            <Text
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
              ta="center"
            >
              잠시만 기다려주세요. 결제 완료 후 자동으로 업데이트됩니다.
            </Text>
          </>
        )}

        {successOrder && validOrder && (
          <>
            <Text style={{ fontSize: 56 }}>✅</Text>
            <Title order={2}>주문이 완료되었습니다</Title>
            <Text style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary)' }}>
              {STATUS_LABELS[validOrder.status]}
            </Text>
            {validOrder.status === 'RECRUITING' && (
              <Text
                style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
              >
                공동구매 목표 달성 시 주문이 확정됩니다.
              </Text>
            )}
            <Text
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
              mt="xs"
            >
              {successOrder.isRoundOrder ? '회차 주문번호' : '주문번호'}: {successOrder.orderNumber}
            </Text>

            {successOrder.isRoundOrder && (
              <>
                <Paper radius="md" p="md" mt="md" w="100%" withBorder>
                  <Group justify="space-between" mb="sm">
                    <Text fw="var(--fw-bold)">주문 상품</Text>
                    <Text size="sm" c="var(--color-text-secondary)">
                      총 {successOrder.items.length}개 상품 · {successOrder.totalQuantity}개
                    </Text>
                  </Group>
                  <Stack gap="xs">
                    {successOrder.items.map((item) => (
                      <Group key={item.id} justify="space-between" align="flex-start">
                        <Text size="sm">
                          {item.productName} × {item.quantity}
                        </Text>
                        <Text size="sm">{item.subtotalAmount.toLocaleString()}원</Text>
                      </Group>
                    ))}
                    <Group justify="space-between" mt="xs">
                      <Text size="sm" fw="var(--fw-bold)">
                        결제 금액
                      </Text>
                      <Text size="sm" fw="var(--fw-bold)">
                        {successOrder.totalAmount.toLocaleString()}원
                      </Text>
                    </Group>
                  </Stack>
                </Paper>

                <Paper
                  radius="md"
                  p="md"
                  mt="sm"
                  w="100%"
                  style={{ background: 'var(--color-surface-muted)' }}
                >
                  <Text fw="var(--fw-bold)" size="sm" mb={4}>
                    화요일 배송 안내
                  </Text>
                  <Text size="sm">
                    화요일 오전 9시까지 문 앞 배송합니다. 경기도 이천시 직접배송 주문입니다.
                  </Text>
                </Paper>
              </>
            )}

            <Button
              color="brand"
              radius="md"
              size="md"
              mt="lg"
              onClick={() => router.push('/mypage')}
            >
              주문 내역 보기
            </Button>
            <Button
              variant="transparent"
              style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
              onClick={() => router.push('/')}
            >
              홈으로
            </Button>
          </>
        )}

        {isCancelled && validOrder && !errorMessage && (
          <>
            <Text style={{ fontSize: 56 }}>❌</Text>
            <Title order={2}>결제가 취소되었습니다</Title>
            <Text
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
              ta="center"
            >
              {typeof validOrder.cancelReason === 'string'
                ? validOrder.cancelReason
                : '결제 처리 중 오류가 발생했습니다.'}
            </Text>
            <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}>
              잠시 후 홈 화면으로 이동합니다.
            </Text>
          </>
        )}

        {errorMessage && <ErrorState message={errorMessage} onHome={() => router.push('/')} />}
      </Stack>
    </Container>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense
      fallback={
        <Container size="sm" px="md" py={60}>
          <Text ta="center">로딩 중...</Text>
        </Container>
      }
    >
      <OrderSuccessContent />
    </Suspense>
  );
}
