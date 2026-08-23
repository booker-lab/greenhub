'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import OrderCard from '@/components/OrderCard';
import { Box, Stack, Title, Text, UnstyledButton, Badge, Anchor } from '@mantine/core';

type Order = {
  id: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  hubName?: string;
  hubAddress?: string;
  productName?: string;
  quantity?: number;
  preparedAt?: { seconds: number } | null;
  deliveredAt?: { seconds: number } | null;
};

export default function BoardClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { firebaseReady } = useFirebaseAuth();
  const tab = searchParams.get('tab') ?? 'preparing';

  const [preparing, setPreparing] = useState<Order[]>([]);
  const [delivering, setDelivering] = useState<Order[]>([]);

  useEffect(() => {
    if (!firebaseReady) return;

    // 기사 수거 대상인 direct·hub 주문만 노출하고 택배 주문은 제외한다.
    const qPreparing = query(
      collection(db, 'orders'),
      where('status', '==', 'PREPARING'),
      where('deliveryMethod', 'in', ['direct', 'hub']),
      where('driverId', '==', null),
      orderBy('preparedAt', 'asc'),
    );
    const unsubPreparing = onSnapshot(qPreparing, (snap) => {
      setPreparing(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order));
    });

    const driverId = session?.user?.id;
    if (!driverId) {
      return () => {
        unsubPreparing();
      };
    }
    const qDelivering = query(
      collection(db, 'orders'),
      where('status', 'in', ['DELIVERING', 'DELIVERY_HELD']),
      where('driverId', '==', driverId),
      orderBy('updatedAt', 'asc'),
    );
    const unsubDelivering = onSnapshot(qDelivering, (snap) => {
      setDelivering(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order));
    });

    return () => {
      unsubPreparing();
      unsubDelivering();
    };
  }, [session?.user?.id, firebaseReady]);

  const orders = tab === 'preparing' ? preparing : delivering;
  const today = new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* 헤더 */}
      <Box
        component="header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg)',
          borderBottom: 'var(--border)',
          padding: '16px 16px 0',
        }}
      >
        <Box mb="sm">
          <Title order={4}>오늘 배송</Title>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {today}
          </Text>
        </Box>

        {/* 탭 */}
        <Box style={{ display: 'flex' }}>
          {[
            { key: 'preparing', label: '수거 대기', count: preparing.length },
            { key: 'delivering', label: '배송 중', count: delivering.length },
          ].map(({ key, label, count }) => (
            <UnstyledButton
              key={key}
              onClick={() => router.replace(`/board?tab=${key}`)}
              style={{
                flex: 1,
                padding: '12px 0',
                textAlign: 'center',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                borderBottom: `2px solid ${tab === key ? 'var(--color-primary)' : 'transparent'}`,
                color: tab === key ? 'var(--color-primary)' : 'var(--color-text-disabled)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {label}
              {count > 0 && (
                <Badge size="xs" color={key === 'preparing' ? 'red' : 'blue'} circle>
                  {count}
                </Badge>
              )}
            </UnstyledButton>
          ))}
        </Box>
      </Box>

      {/* 주문 목록 */}
      <Box component="main" style={{ flex: 1, padding: '16px' }}>
        {orders.length === 0 ? (
          <Stack align="center" justify="center" h={192} gap="xs">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {tab === 'preparing'
                ? '오늘 수거할 주문이 없습니다'
                : '현재 배송 중인 주문이 없습니다'}
            </Text>
            {tab === 'preparing' && (
              <Anchor
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}
                onClick={() => router.push('/map')}
              >
                지도에서 경로 보기
              </Anchor>
            )}
          </Stack>
        ) : (
          <Stack gap="sm">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} tab={tab} />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
