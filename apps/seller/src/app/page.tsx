'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useFirebaseReady } from '@/app/providers';
import { useOrders } from '@/hooks/useOrders';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import Link from 'next/link';
import { Box, Container, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';

interface MetricCardProps {
  label: string;
  value: number;
  href: string;
  accent?: boolean;
}

function MetricCard({ label, value, href, accent }: MetricCardProps) {
  return (
    <Paper
      component={Link}
      href={href}
      radius="lg"
      shadow="xs"
      p="md"
      style={{ flex: 1, minWidth: 0, textDecoration: 'none', display: 'block' }}
    >
      <Stack gap={4} align="center">
        <Text
          style={{
            fontSize: 28,
            fontWeight: 'var(--fw-bold)',
            color: accent ? 'var(--color-danger)' : 'var(--color-text)',
            lineHeight: 1,
          }}
        >
          {value}
        </Text>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          {label}
        </Text>
      </Stack>
    </Paper>
  );
}

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const storeId = session?.user.storeId ?? null;
  const firebaseReady = useFirebaseReady();
  const { orders, loading, error, groupCounts } = useOrders(storeId);
  const { products } = useStoreProducts(storeId);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') { router.replace('/login'); return; }
  }, [status, session, router]);

  if (status === 'loading' || !session) {
    return (
      <Box style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100dvh' }}>
        <Loader size="sm" color="var(--color-primary)" />
      </Box>
    );
  }

  const isConnecting = loading || !firebaseReady;
  const dotColor = isConnecting
    ? 'var(--color-caution-border)'
    : error
      ? 'var(--color-danger)'
      : 'var(--color-primary)';
  const connLabel = isConnecting ? '연결 중' : error ? '연결 오류' : '실시간 연결';

  const inactiveCount = products.filter((p) => !p.isActive).length;

  return (
    <Box component="main" style={{ minHeight: '100dvh', backgroundColor: 'var(--color-surface-muted)' }}>
      <Box
        component="header"
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          padding: '16px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group justify="space-between">
            <Title order={3} style={{ fontWeight: 'var(--fw-bold)' }}>
              홈
            </Title>
            <Group gap={6}>
              <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dotColor }} />
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
                {connLabel}
              </Text>
            </Group>
          </Group>
        </Container>
      </Box>

      <Container size="sm" py="md">
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
            marginBottom: 8,
            fontWeight: 'var(--fw-medium)',
          }}
        >
          주문 현황
        </Text>
        <Group gap="xs" mb="md" grow>
          <MetricCard label="신규 주문" value={groupCounts.ACTION_REQUIRED} href="/orders" accent={groupCounts.ACTION_REQUIRED > 0} />
          <MetricCard label="전체 주문" value={orders.length} href="/orders" />
          <MetricCard label="취소" value={groupCounts.CANCELLED} href="/orders?tab=CANCELLED" />
        </Group>

        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
            marginBottom: 8,
            fontWeight: 'var(--fw-medium)',
          }}
        >
          상품 현황
        </Text>
        <Group gap="xs" grow>
          <MetricCard label="재고부족" value={inactiveCount} href="/products" accent={inactiveCount > 0} />
        </Group>
      </Container>
    </Box>
  );
}
