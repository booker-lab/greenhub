'use client';

import { Anchor, Badge, Box, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import OrderCard from '@/components/OrderCard';
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth';
import { db } from '@/lib/firebase';
import { BOARD_TABS, type DriverBoardOrder, getBoardEmptyMessage, parseBoardTab } from './_lib';

export default function BoardClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { firebaseReady } = useFirebaseAuth();
  const tab = parseBoardTab(searchParams.get('tab'));

  const [preparing, setPreparing] = useState<DriverBoardOrder[]>([]);
  const [delivering, setDelivering] = useState<DriverBoardOrder[]>([]);

  useEffect(() => {
    if (!firebaseReady) return;

    // BUG-16 T4: parcel 주문은 셀러가 직접 발송하므로 드라이버 수거 대기 목록에서 제외.
    const qPreparing = query(
      collection(db, 'orders'),
      where('status', '==', 'PREPARING'),
      where('deliveryMethod', 'in', ['direct', 'hub']),
      orderBy('preparedAt', 'asc'),
    );
    const unsubPreparing = onSnapshot(qPreparing, (snap) => {
      setPreparing(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DriverBoardOrder));
    });

    const driverId = session?.user?.id;
    const deliveringConditions = driverId
      ? [
          where('status', '==', 'DELIVERING'),
          where('driverId', '==', driverId),
          orderBy('updatedAt', 'asc'),
        ]
      : [where('status', '==', 'DELIVERING'), orderBy('updatedAt', 'asc')];
    const qDelivering = query(collection(db, 'orders'), ...deliveringConditions);
    const unsubDelivering = onSnapshot(qDelivering, (snap) => {
      setDelivering(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DriverBoardOrder));
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
          {BOARD_TABS.map(({ key, label, badgeColor }) => {
            const count = key === 'preparing' ? preparing.length : delivering.length;
            return (
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
                  <Badge size="xs" color={badgeColor} circle>
                    {count}
                  </Badge>
                )}
              </UnstyledButton>
            );
          })}
        </Box>
      </Box>

      {/* 주문 목록 */}
      <Box component="main" style={{ flex: 1, padding: '16px' }}>
        {orders.length === 0 ? (
          <Stack align="center" justify="center" h={192} gap="xs">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {getBoardEmptyMessage(tab)}
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
