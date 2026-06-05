'use client';

import { Badge, Box, Button, Stack, Text, Title } from '@mantine/core';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { useFirebaseAuth } from '@/hooks/useFirebaseAuth';
import { db } from '@/lib/firebase';
import { KakaoRouteMap } from './_components/KakaoRouteMap';
import {
  buildKakaoNaviUrl,
  type DriverMapOrder,
  getMapOrderAddress,
  getMapStatusBadge,
  nearestNeighbor,
} from './_lib';

export default function MapPage() {
  const { firebaseReady } = useFirebaseAuth();
  const [orders, setOrders] = useState<DriverMapOrder[]>([]);

  useEffect(() => {
    if (!firebaseReady) return;

    const q = query(collection(db, 'orders'), where('status', 'in', ['PREPARING', 'DELIVERING']));
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DriverMapOrder));
    });
    return unsub;
  }, [firebaseReady]);

  const sorted = nearestNeighbor(orders);

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
          padding: '16px',
        }}
      >
        <Title order={4}>오늘 배송 경로</Title>
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mt={2}
        >
          총 {orders.length}건
        </Text>
      </Box>

      <KakaoRouteMap orders={sorted} />

      {/* 경유지 목록 */}
      <Box style={{ flex: 1, padding: '16px' }}>
        {sorted.length === 0 ? (
          <Box
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128 }}
          >
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              오늘 배송 주문이 없습니다
            </Text>
          </Box>
        ) : (
          <Stack gap="xs">
            {sorted.map((order, idx) => {
              const badge = getMapStatusBadge(order.status);
              return (
                <Box
                  key={order.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    backgroundColor: 'var(--color-bg)',
                    borderRadius: 12,
                    border: 'var(--border)',
                    padding: '12px 16px',
                  }}
                >
                  <Box
                    style={{
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-bg)',
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-bold)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {idx + 1}
                  </Box>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
                      truncate="end"
                    >
                      {order.buyerName ?? '소비자'}
                    </Text>
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                      truncate="end"
                    >
                      {getMapOrderAddress(order)}
                    </Text>
                  </Box>
                  <Badge size="xs" color={badge.color} variant="light">
                    {badge.label}
                  </Badge>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>

      {/* 주행 시작 버튼 */}
      {sorted.length > 0 && (
        <Box style={{ position: 'sticky', bottom: 72, padding: '0 16px 16px' }}>
          <Button
            component="a"
            href={buildKakaoNaviUrl(sorted)}
            fullWidth
            size="lg"
            radius="xl"
            color="brand"
          >
            주행 시작 (카카오내비)
          </Button>
        </Box>
      )}
    </Box>
  );
}
