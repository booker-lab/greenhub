'use client';

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
import { groupOrdersBySaleType, toOrderCardViewModel, type OrderCardViewModel } from './_lib';

function OrderCard({ viewModel, onClick }: { viewModel: OrderCardViewModel; onClick: () => void }) {
  return (
    <UnstyledButton
      onClick={onClick}
      data-testid="order-card"
      style={{
        display: 'block',
        width: '100%',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderLeft: `4px solid ${viewModel.accentColor}`,
        borderRadius: 'var(--radius-sm)',
        padding: '14px 16px',
      }}
    >
      <Group justify="space-between" mb={8}>
        <Box
          style={{
            fontSize: 12,
            fontWeight: 'var(--fw-bold)',
            color: viewModel.statusColor.text,
            background: viewModel.statusColor.bg,
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
          }}
        >
          {viewModel.actionSignal}
        </Box>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {viewModel.createdAtLabel}
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
        {viewModel.saleTypeLabel ? `[${viewModel.saleTypeLabel}] ` : ''}
        {viewModel.deliveryMethodLabel}
      </Text>
      <Group justify="space-between">
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {viewModel.quantityLabel}
        </Text>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {viewModel.statusLabel}
        </Text>
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-text)',
          }}
        >
          {viewModel.totalAmountLabel}
        </Text>
      </Group>
    </UnstyledButton>
  );
}

function OrderSection({
  title,
  orders,
  onSelect,
}: {
  title: string;
  orders: ReturnType<typeof groupOrdersBySaleType>['normalOrders'];
  onSelect: (id: string) => void;
}) {
  if (orders.length === 0) return null;

  return (
    <Stack gap="xs">
      <Text style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}>
        {title}
      </Text>
      {orders.map((order) => (
        <OrderCard
          key={order.id}
          viewModel={toOrderCardViewModel(order)}
          onClick={() => onSelect(order.id)}
        />
      ))}
    </Stack>
  );
}

export default function MyPageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { orders, loading, error } = useOrders();
  const groupedOrders = groupOrdersBySaleType(orders);

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
            <OrderSection
              title="일반 주문"
              orders={groupedOrders.normalOrders}
              onSelect={(id) => router.push(`/mypage/orders/${id}`)}
            />
            <OrderSection
              title="공동구매 참여 내역"
              orders={groupedOrders.groupOrders}
              onSelect={(id) => router.push(`/mypage/orders/${id}`)}
            />
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
