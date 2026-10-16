'use client';

import { Box, Container, Stack, Text, Title } from '@mantine/core';
import { notFound } from 'next/navigation';
import { useState } from 'react';
import { couponLabel } from '@/components/benchmark/CouponStrip';
import StampCard from '@/components/benchmark/StampCard';
import { useCoupons } from '@/hooks/useBenchmark';
import { useProducts } from '@/hooks/useProducts';
import { isFeatureOn } from '@/lib/features';

// 내 쿠폰(coupons)과 구매 스탬프(purchase-stamps). 기능이 꺼져 있으면 없는 화면이다.
export default function MyCouponsPage() {
  if (!isFeatureOn('coupons')) notFound();
  return <MyCouponsContent />;
}

function MyCouponsContent() {
  const { products } = useProducts();
  const storeId = products[0]?.storeId ?? null;
  const { mine, unclaimed, claim } = useCoupons(storeId, true);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Container size="sm" px="md" pt="lg" pb={100}>
      <Title order={1} mb="md" style={{ fontSize: 22, fontWeight: 800 }}>
        내 쿠폰
      </Title>
      <Stack gap="md">
        {isFeatureOn('purchase-stamps') && <StampCard storeId={storeId} />}
        {unclaimed.length > 0 && (
          <Box>
            <Text fw={800} mb="xs">
              받을 수 있는 쿠폰
            </Text>
            <Stack gap="xs">
              {unclaimed.map((coupon) => (
                <CouponRow
                  key={coupon.id}
                  name={coupon.name}
                  detail={couponLabel(coupon)}
                  action={{
                    label: '받기',
                    onClick: async () => {
                      const result = await claim(coupon.id);
                      setMessage(result === 'ok' ? '쿠폰을 받았어요.' : result === 'login' ? null : result);
                    },
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}
        <Box>
          <Text fw={800} mb="xs">
            가진 쿠폰 {mine.filter((c) => c.status === 'available').length}장
          </Text>
          {mine.length === 0 ? (
            <Text size="sm" c="var(--color-text-secondary)">
              아직 받은 쿠폰이 없어요.
            </Text>
          ) : (
            <Stack gap="xs">
              {mine.map((coupon) => (
                <CouponRow
                  key={coupon.id}
                  name={coupon.name}
                  detail={`${couponLabel(coupon)}${coupon.status === 'used' ? ' · 사용함' : ''}`}
                  muted={coupon.status === 'used'}
                />
              ))}
            </Stack>
          )}
          <Text size="sm" c="var(--color-text-secondary)" mt="sm">
            결제할 때 할인이 가장 큰 쿠폰 한 장이 자동으로 적용돼요.
          </Text>
        </Box>
        {message && (
          <Text role="status" size="sm" c="var(--color-primary-dark)">
            {message}
          </Text>
        )}
      </Stack>
    </Container>
  );
}

function CouponRow({
  name,
  detail,
  muted = false,
  action,
}: {
  name: string;
  detail: string;
  muted?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Box
      p="md"
      style={{
        alignItems: 'center',
        background: muted ? 'var(--color-surface-muted)' : 'var(--color-bg)',
        border: 'var(--border)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        gap: 8,
        justifyContent: 'space-between',
        opacity: muted ? 0.7 : 1,
      }}
    >
      <Box style={{ minWidth: 0 }}>
        <Text fw={800} size="sm">
          {name}
        </Text>
        <Text size="sm" c="var(--color-text-secondary)">
          {detail}
        </Text>
      </Box>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            background: 'var(--color-primary)',
            border: 0,
            borderRadius: 'var(--radius-full)',
            color: 'var(--color-bg)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 'var(--font-size-md)',
            fontWeight: 800,
            minHeight: 'var(--touch-target)',
            padding: '0 16px',
          }}
        >
          {action.label}
        </button>
      )}
    </Box>
  );
}
