'use client';

import { Box, Container, Stack, Text, Title } from '@mantine/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useHomeCardContext } from '@/components/HomeProductList';
import ProductTopBar from '@/components/ProductTopBar';
import { useProducts } from '@/hooks/useProducts';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';

// 품질 보장 모아보기(quality-guarantee, 벤치마킹 비교 기능). 보장 조건과 이번 회차 보장 상품.
export default function GuaranteePage() {
  if (!isFeatureOn('quality-guarantee')) notFound();
  return <GuaranteeContent />;
}

function GuaranteeContent() {
  const { products } = useProducts();
  const storeId = products[0]?.storeId ?? null;
  const card = useHomeCardContext(storeId, products);
  const guarantee = card.storeProfile?.guarantee;
  const { currentRound } = useSaleRounds(storeId);
  const items =
    currentRound?.items.filter(
      (item) => item.status !== 'HIDDEN' && card.productsById.get(item.productId)?.guaranteed,
    ) ?? [];

  return (
    <Container size="sm" p={0} pb={100}>
      <ProductTopBar />
      <Stack gap="lg" px="md" style={{ paddingTop: 'calc(68px + env(safe-area-inset-top))' }}>
        <Title order={1} style={{ fontSize: 22, fontWeight: 800 }}>
          {guarantee?.enabled ? guarantee.title : '품질 보장'}
        </Title>
        {guarantee?.enabled ? (
          <Box p="md" style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {guarantee.terms.map((term) => (
                <li key={term} style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.7 }}>
                  {term}
                </li>
              ))}
            </ul>
          </Box>
        ) : (
          <Text size="sm" c="var(--color-text-secondary)">
            지금은 품질 보장을 운영하지 않아요.
          </Text>
        )}
        <Box>
          <Text fw={800} mb="sm">
            이번 회차 보장 상품 {items.length}
          </Text>
          <Stack gap="xs">
            {items.map((item) => (
              <Box
                key={item.id}
                component={Link}
                href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(item.roundId)}`}
                p="md"
                style={{ border: 'var(--border)', borderRadius: 'var(--radius)', color: 'inherit', display: 'flex', justifyContent: 'space-between', textDecoration: 'none' }}
              >
                <Text size="sm" fw={700}>
                  {item.productNameSnapshot}
                </Text>
                <Text size="sm" fw={800}>
                  {item.roundPrice.toLocaleString()}원
                </Text>
              </Box>
            ))}
          </Stack>
        </Box>
      </Stack>
    </Container>
  );
}
