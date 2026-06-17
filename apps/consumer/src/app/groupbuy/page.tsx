'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Container, Box, Text, SimpleGrid, Skeleton, Stack } from '@mantine/core';
import { getGroupBuyStatus } from '@greenhub/shared';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';

export default function GroupBuyPage() {
  const { products, loading, error } = useProducts(undefined, undefined, 'group');

  const { active, closed, needsCheck, urgentCount } = useMemo(() => {
    const active = [];
    const closed = [];
    const needsCheck = [];
    let urgentCount = 0;

    for (const product of products) {
      const status = getGroupBuyStatus(product.groupSummary);
      if (status.status === 'recruiting') {
        active.push(product);
        const deadlineTime = status.deadline?.getTime() ?? 0;
        if (deadlineTime > Date.now() && deadlineTime - Date.now() <= 24 * 60 * 60 * 1000) {
          urgentCount += 1;
        }
      } else if (status.status === 'missing_config' || status.status === 'invalid_config') {
        needsCheck.push(product);
      } else {
        closed.push(product);
      }
    }

    return { active, closed, needsCheck, urgentCount };
  }, [products]);

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      {/* 히어로 배너 — 플랫 미니멀 */}
      <Box
        mb="xl"
        p="lg"
        style={{
          backgroundColor: 'var(--color-primary-surface)',
          borderRadius: 'var(--radius)',
          border: 'var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-primary)',
            }}
          >
            ⚡ 공동구매
          </span>
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-bg)',
              background: 'var(--color-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 8px',
            }}
          >
            진행 중
          </span>
        </div>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.6,
            margin: '0 0 8px',
          }}
        >
          함께 모이면 더 저렴하게! 목표 수량이 채워지면 주문이 확정됩니다.
        </p>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-primary)',
            margin: 0,
            fontWeight: 'var(--fw-medium)',
          }}
        >
          현재 {loading ? '...' : `${active.length}개`} 모집 중 · 마감 임박 {urgentCount}개
        </p>
      </Box>

      {loading && (
        <SimpleGrid cols={2} spacing="sm">
          {['첫 번째', '두 번째', '세 번째', '네 번째'].map((label) => (
            <Skeleton key={label} height={260} radius="md" />
          ))}
        </SimpleGrid>
      )}

      {!loading && error && (
        <Stack align="center" py={48}>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {error}
          </Text>
        </Stack>
      )}

      {!loading && !error && products.length === 0 && (
        <Stack align="center" py={64}>
          <Text size="xl">🌱</Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            진행 중인 공동구매가 없습니다.
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            <Link href="/" style={{ color: 'inherit' }}>
              전체 상품 보기
            </Link>
          </Text>
        </Stack>
      )}

      {!loading && active.length > 0 && (
        <Box mb="xl">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              모집 중
            </span>
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-primary)',
                background: 'var(--color-primary-surface)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
              }}
            >
              {active.length}
            </span>
          </div>
          <SimpleGrid cols={2} spacing="sm">
            {active.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {!loading && closed.length > 0 && (
        <Box mb="xl">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text-disabled)',
              }}
            >
              모집 완료·종료
            </span>
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text-disabled)',
                background: 'var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
              }}
            >
              {closed.length}
            </span>
          </div>
          <SimpleGrid cols={2} spacing="sm" style={{ opacity: 0.6 }}>
            {closed.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {!loading && needsCheck.length > 0 && (
        <Box>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text-disabled)',
              }}
            >
              정보 확인 필요
            </span>
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text-disabled)',
                background: 'var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
              }}
            >
              {needsCheck.length}
            </span>
          </div>
          <SimpleGrid cols={2} spacing="sm" style={{ opacity: 0.75 }}>
            {needsCheck.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        </Box>
      )}
    </Container>
  );
}
