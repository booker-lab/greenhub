'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useOrders } from '@/hooks/useOrders';
import { OrderCard } from './_components/OrderCard';
import {
  GROUP_TABS,
  STATUS_GROUP_MAP,
  SUMMARY_BAR_ITEMS,
  IN_DELIVERY_SUBFILTERS,
  type OrderGroup,
} from './_constants';
import {
  Badge,
  Box,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';

const VALID_TABS = new Set<OrderGroup>(['ACTION_REQUIRED', 'WAITING', 'IN_DELIVERY', 'DONE', 'CANCELLED']);

export default function OrdersPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const { orders, loading, error, groupCounts, firebaseReady } = useOrders(storeId);
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<OrderGroup>('ACTION_REQUIRED');
  const [subFilter, setSubFilter] = useState<'ALL' | 'DELIVERING' | 'HUB_ARRIVED'>('ALL');

  useEffect(() => {
    const tab = searchParams.get('tab') as OrderGroup | null;
    if (tab && VALID_TABS.has(tab)) setActiveTab(tab);
  }, [searchParams]);

  const filteredOrders = orders.filter((o) => {
    if (STATUS_GROUP_MAP[o.status] !== activeTab) return false;
    if (activeTab === 'IN_DELIVERY' && subFilter !== 'ALL') {
      return o.status === subFilter;
    }
    return true;
  });

  return (
    <Box
      component="main"
      style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface-muted)' }}
    >
      {/* 헤더 */}
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
              주문 관리
            </Title>
            <Group gap={6}>
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor:
                    loading || !firebaseReady
                      ? 'var(--color-caution-border)'
                      : error
                        ? 'var(--color-danger)'
                        : 'var(--color-primary)',
                }}
              />
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
                {loading || !firebaseReady ? '연결 중' : error ? '연결 오류' : '실시간 연결'}
              </Text>
            </Group>
          </Group>
        </Container>
      </Box>

      {/* Summary Bar */}
      <Box style={{ backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', padding: '8px 0', position: 'sticky', top: 57, zIndex: 9 }}>
        <Container size="sm">
          <Group gap="md">
            {SUMMARY_BAR_ITEMS.map((item) => (
              <UnstyledButton
                key={item.group}
                onClick={() => setActiveTab(item.group)}
                style={{ textAlign: 'center' }}
              >
                <Text style={{ fontSize: 20, fontWeight: 'var(--fw-bold)', color: 'var(--color-text)', lineHeight: 1 }}>
                  {groupCounts[item.group]}
                </Text>
                <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)', marginTop: 2 }}>
                  {item.label}
                </Text>
              </UnstyledButton>
            ))}
          </Group>
        </Container>
      </Box>

      {/* 상태 탭 */}
      <Box
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky',
          top: 114,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group gap={0} style={{ overflowX: 'auto', flexWrap: 'nowrap', scrollbarWidth: 'none' }}>
            {GROUP_TABS.map((tab) => (
              <UnstyledButton
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSubFilter('ALL'); }}
                style={{
                  flexShrink: 0,
                  padding: '12px 16px',
                  fontSize: 14,
                  fontWeight: activeTab === tab.key ? 700 : 400,
                  borderBottom: `2px solid ${activeTab === tab.key ? 'var(--color-text)' : 'transparent'}`,
                  color: activeTab === tab.key ? 'var(--color-text)' : 'var(--color-text-disabled)',
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
                {groupCounts[tab.key] > 0 && (
                  <Badge size="xs" ml={6} color={tab.key === 'ACTION_REQUIRED' ? 'red' : 'gray'}>
                    {groupCounts[tab.key]}
                  </Badge>
                )}
              </UnstyledButton>
            ))}
          </Group>
        </Container>
      </Box>

      {/* SubFilter — IN_DELIVERY 탭 선택 시에만 렌더링 */}
      {activeTab === 'IN_DELIVERY' && (
        <Box style={{ backgroundColor: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)', padding: '6px 0' }}>
          <Container size="sm">
            <Group gap={0}>
              {IN_DELIVERY_SUBFILTERS.map((sf) => (
                <UnstyledButton
                  key={sf.key}
                  onClick={() => setSubFilter(sf.key)}
                  style={{
                    padding: '6px 14px',
                    fontSize: 13,
                    borderRadius: 99,
                    backgroundColor: subFilter === sf.key ? 'var(--color-text)' : 'transparent',
                    color: subFilter === sf.key ? 'var(--color-bg)' : 'var(--color-text-disabled)',
                    transition: 'all 0.15s',
                  }}
                >
                  {sf.label}
                </UnstyledButton>
              ))}
            </Group>
          </Container>
        </Box>
      )}

      {/* 주문 목록 */}
      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          {(loading || !firebaseReady) && (
            <Group justify="center" py={80}>
              <Loader size="sm" color="brand" />
            </Group>
          )}

          {!loading && firebaseReady && filteredOrders.length === 0 && (
            <Stack align="center" justify="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
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
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>현재 해당 주문이 없습니다</Text>
            </Stack>
          )}

          {filteredOrders.map((order) => (
            <OrderCard key={order.id} order={order} storeId={storeId} />
          ))}
        </Stack>
      </Container>
    </Box>
  );
}
