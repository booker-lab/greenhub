'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Box, Container, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import { useFirebaseReady } from '@/app/providers';
import { useOrders } from '@/hooks/useOrders';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { aggregatePrep, type PrepLine } from '@/lib/prep';

function PrepRow({ line, index, accent }: { line: PrepLine; index: number; accent?: boolean }) {
  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      py={10}
      style={index > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}
    >
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          {line.productName}
        </Text>
        {line.selectionLabel && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            ({line.selectionLabel})
          </Text>
        )}
      </Group>
      <Text
        style={{
          fontSize: 'var(--font-size-md)',
          fontWeight: 'var(--fw-bold)',
          color: accent ? 'var(--color-danger)' : 'var(--color-text)',
          flexShrink: 0,
        }}
      >
        {line.quantity}개
      </Text>
    </Group>
  );
}

export default function PrepPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const firebaseReady = useFirebaseReady();
  const { orders, loading, error } = useOrders(storeId);
  const { products } = useStoreProducts(storeId);

  const { today, delayed } = useMemo(
    () => aggregatePrep(orders, products),
    [orders, products],
  );

  const isConnecting = loading || !firebaseReady;
  const dotColor = isConnecting
    ? 'var(--color-caution-border)'
    : error
      ? 'var(--color-danger)'
      : 'var(--color-primary)';
  const connLabel = isConnecting ? '연결 중' : error ? '연결 오류' : '실시간 연결';

  const todayLabel = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const todayTotal = today.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <PageShell>
      <PageHeader
        title="준비 물량"
        right={
          <Group gap={6}>
            <Box
              style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dotColor }}
            />
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {connLabel}
            </Text>
          </Group>
        }
      />

      <Container size="sm" px="md" py="md">
        {isConnecting && <LoadingState />}

        {!isConnecting && today.length === 0 && delayed.length === 0 && (
          <EmptyState text="오늘 준비할 물량이 없습니다" />
        )}

        {!isConnecting && (today.length > 0 || delayed.length > 0) && (
          <Stack gap="md">
            {today.length > 0 && (
              <Paper radius="lg" shadow="xs" p="md">
                <Text
                  style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}
                >
                  오늘 준비 물량 ({todayLabel})
                </Text>
                <Box mt="sm">
                  {today.map((line, i) => (
                    <PrepRow key={line.productId} line={line} index={i} />
                  ))}
                </Box>
                <Group
                  justify="flex-end"
                  pt={10}
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                      fontWeight: 'var(--fw-medium)',
                    }}
                  >
                    {today.length}개 상품 · 총 {todayTotal}개
                  </Text>
                </Group>
              </Paper>
            )}

            {delayed.length > 0 && (
              <Paper
                radius="lg"
                shadow="xs"
                p="md"
                style={{ border: '1px solid var(--color-danger)' }}
              >
                <Text
                  style={{
                    fontSize: 'var(--font-size-md)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-danger)',
                  }}
                >
                  🔴 발송 지연 (배송일 경과)
                </Text>
                <Box mt="sm">
                  {delayed.map((line, i) => (
                    <PrepRow key={line.productId} line={line} index={i} accent />
                  ))}
                </Box>
                <UnstyledButton
                  component={Link}
                  href="/orders?tab=ACTION_REQUIRED"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 2,
                    paddingTop: 10,
                    borderTop: '1px solid var(--color-border)',
                  }}
                >
                  <Text
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                  >
                    주문 관리에서 처리하기
                  </Text>
                  <ChevronRight size={14} color="var(--color-text-secondary)" />
                </UnstyledButton>
              </Paper>
            )}
          </Stack>
        )}
      </Container>
    </PageShell>
  );
}
