'use client';

import type { Order, OrderStatus } from '@greenhub/shared';
import {
  Box,
  Button,
  Container,
  Divider,
  Group,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import A2HSButton from '@/components/A2HSButton';
import { useOrders } from '@/hooks/useOrders';

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  DELIVERY_HELD: '배송 보류',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '구매 확정',
};

type StatusColorKey = { bg: string; text: string };
const STATUS_COLORS: Partial<Record<OrderStatus, StatusColorKey>> = {
  PENDING: { bg: 'var(--color-surface-muted)', text: 'var(--color-text-secondary)' },
  RECRUITING: { bg: 'var(--color-status-info-bg)', text: 'var(--color-status-info-text)' },
  CONFIRMED: { bg: 'var(--color-status-info-bg)', text: 'var(--color-status-info-text)' },
  ACCEPTED: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary)' },
  PREPARING: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary)' },
  DELIVERING: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
  DELIVERY_HELD: { bg: 'var(--color-danger-surface)', text: 'var(--color-danger)' },
  HUB_ARRIVED: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
  PICKED_UP: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary)' },
  DELIVERED: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary)' },
  CANCELLED: { bg: 'var(--color-danger-surface)', text: 'var(--color-danger)' },
  REVIEWED: { bg: 'var(--color-surface-muted)', text: 'var(--color-text-secondary)' },
};

const ACCENT_COLORS: Partial<Record<OrderStatus, string>> = {
  PENDING: 'var(--color-text-disabled)',
  RECRUITING: 'var(--color-status-info-text)',
  CONFIRMED: 'var(--color-status-info-text)',
  ACCEPTED: 'var(--color-primary)',
  PREPARING: 'var(--color-primary)',
  DELIVERING: 'var(--color-status-warning-text)',
  DELIVERY_HELD: 'var(--color-danger)',
  HUB_ARRIVED: 'var(--color-status-warning-text)',
  PICKED_UP: 'var(--color-primary)',
  DELIVERED: 'var(--color-primary)',
  CANCELLED: 'var(--color-danger)',
  REVIEWED: 'var(--color-text-disabled)',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

interface OrderListSummary {
  representativeName: string;
  additionalProductCount: number;
  productCount: number;
  totalQuantity: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readOrderListSummary(value: unknown): OrderListSummary | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.status) ||
    !Object.hasOwn(STATUS_LABELS, value.status) ||
    !Array.isArray(value.orderItems) ||
    value.orderItems.length === 0
  ) {
    return null;
  }

  const identities = new Set<string>();
  let representativeName = '';
  let totalQuantity = 0;

  for (const item of value.orderItems) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.productId) ||
      !isNonEmptyString(item.productName) ||
      !isPositiveQuantity(item.quantity) ||
      (item.roundItemId !== undefined &&
        item.roundItemId !== null &&
        !isNonEmptyString(item.roundItemId))
    ) {
      return null;
    }

    const identity = isNonEmptyString(item.roundItemId) ? item.roundItemId : item.productId;
    if (identities.has(identity)) return null;
    identities.add(identity);

    if (!representativeName) representativeName = item.productName.trim();
    totalQuantity += item.quantity;
    if (!Number.isSafeInteger(totalQuantity)) return null;
  }

  return {
    representativeName,
    additionalProductCount: value.orderItems.length - 1,
    productCount: value.orderItems.length,
    totalQuantity,
  };
}

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const colorScheme = STATUS_COLORS[order.status] ?? {
    bg: 'var(--color-surface-muted)',
    text: 'var(--color-text-secondary)',
  };
  const accentColor = ACCENT_COLORS[order.status] ?? 'var(--color-text-disabled)';
  const label = STATUS_LABELS[order.status] ?? order.status;
  const summary = readOrderListSummary(order);

  return (
    <UnstyledButton
      onClick={onClick}
      data-testid="order-card"
      style={{
        display: 'block',
        width: '100%',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 'var(--radius-sm)',
        padding: '14px 16px',
      }}
    >
      <Group justify="space-between" mb={8}>
        <Box
          style={{
            fontSize: 12,
            fontWeight: 'var(--fw-bold)',
            color: colorScheme.text,
            background: colorScheme.bg,
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          {label}
        </Box>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {formatDate(order.createdAt)}
        </Text>
      </Group>
      <Text
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
        }}
        mb={4}
      >
        {order.saleType === 'group' ? '[공동구매] ' : ''}
        {order.deliveryMethod === 'hub'
          ? '거점 픽업'
          : order.deliveryMethod === 'parcel'
            ? '택배'
            : '직배송'}
      </Text>
      {summary && (
        <Text
          style={{
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-text)',
          }}
          mb={4}
        >
          {summary.representativeName}
          {summary.additionalProductCount > 0 ? ` 외 ${summary.additionalProductCount}개` : ''}
        </Text>
      )}
      <Group justify="space-between">
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {summary
            ? `상품 ${summary.productCount}종 · 총 수량 ${summary.totalQuantity}개`
            : `수량 ${order.quantity}개`}
        </Text>
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-text)',
          }}
        >
          {order.totalAmount.toLocaleString('ko-KR')}원
        </Text>
      </Group>
    </UnstyledButton>
  );
}

export default function MyPageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { orders, loading, error } = useOrders();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <Box py={60} ta="center">
        <Text style={{ color: 'var(--color-text-disabled)' }}>로딩 중...</Text>
      </Box>
    );
  }

  if (!session) return null;

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      {/* 프로필 */}
      <Box
        mb="xl"
        p="lg"
        style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius-sm)' }}
      >
        <Group justify="space-between" align="flex-start">
          <Box>
            <Title
              order={4}
              style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
              mb={4}
            >
              {session.user?.name ?? '사용자'}
            </Title>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {session.user?.email}
            </Text>
          </Box>
          <Button
            variant="default"
            size="xs"
            radius="sm"
            onClick={() => signOut({ callbackUrl: '/' })}
          >
            로그아웃
          </Button>
        </Group>
      </Box>

      {/* 주문 내역 */}
      <Box mb="xl">
        <Stack gap={4} mb="md">
          <Title order={5} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
            주문 내역
          </Title>
          <Divider />
        </Stack>
        {loading && (
          <Text
            ta="center"
            style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
            py="lg"
          >
            불러오는 중...
          </Text>
        )}
        {!loading && error && (
          <Text style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }} py="xs">
            주문 내역을 불러올 수 없습니다.
          </Text>
        )}
        {!loading && !error && orders.length === 0 && (
          <Text
            ta="center"
            style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
            py="xl"
          >
            주문 내역이 없습니다.
          </Text>
        )}
        {!loading && orders.length > 0 && (
          <Stack gap="sm">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onClick={() => router.push(`/mypage/orders/${order.id}`)}
              />
            ))}
          </Stack>
        )}
      </Box>

      {/* 메뉴 */}
      <Box mb="xl">
        <Stack gap={4} mb="md">
          <Title order={5} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
            내 정보
          </Title>
          <Divider />
        </Stack>
        <Stack gap="xs">
          <UnstyledButton
            onClick={() => router.push('/mypage/notifications')}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 16px',
            }}
          >
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text)',
              }}
            >
              알림 내역
            </Text>
            <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-md)' }}>
              ›
            </Text>
          </UnstyledButton>
          <UnstyledButton
            onClick={() => router.push('/mypage/addresses')}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 16px',
            }}
          >
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text)',
              }}
            >
              배송지 목록 · 추가 · 수정
            </Text>
            <Text style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-md)' }}>
              ›
            </Text>
          </UnstyledButton>
        </Stack>
      </Box>

      {/* 앱 설치 */}
      <Box>
        <Stack gap={4} mb="md">
          <Title order={5} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
            앱 설치
          </Title>
          <Divider />
        </Stack>
        <A2HSButton />
      </Box>
    </Container>
  );
}
