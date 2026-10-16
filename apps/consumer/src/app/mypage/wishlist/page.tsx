'use client';

import { Box, Button, Container, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useProductToggleSet } from '@/hooks/useBenchmark';
import { useProducts } from '@/hooks/useProducts';
import { isFeatureOn } from '@/lib/features';

// 찜한 꽃(wishlist, 벤치마킹 비교 기능). 기능이 꺼져 있으면 없는 화면이다.
export default function WishlistPage() {
  if (!isFeatureOn('wishlist')) notFound();
  return <WishlistContent />;
}

function WishlistContent() {
  const wishlist = useProductToggleSet('wishlist', true);
  const { products, loading } = useProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = [...wishlist.ids].map((id) => byId.get(id)).filter((p) => p !== undefined);

  return (
    <Container size="sm" px="md" pt="lg" pb={100}>
      <Title order={1} mb="md" style={{ fontSize: 22, fontWeight: 800 }}>
        찜한 꽃
      </Title>
      {!loading && items.length === 0 ? (
        <Stack align="center" py={48} gap="md">
          <Text c="var(--color-text-secondary)">아직 찜한 꽃이 없어요.</Text>
          <Button component={Link} href="/" radius="xl">
            이번 회차 보러 가기
          </Button>
        </Stack>
      ) : (
        <SimpleGrid cols={2} spacing={12}>
          {items.map((product) => (
            <Box
              key={product.id}
              p="sm"
              style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}
            >
              <Text component={Link} href={`/products/${encodeURIComponent(product.id)}`} fw={800} size="sm" style={{ color: 'var(--color-text)', textDecoration: 'none' }}>
                {product.name}
              </Text>
              <button
                type="button"
                onClick={() => void wishlist.toggle(product.id)}
                style={{
                  background: 'var(--color-surface-muted)',
                  border: 0,
                  borderRadius: 'var(--radius-full)',
                  cursor: 'pointer',
                  display: 'block',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 700,
                  marginTop: 8,
                  minHeight: 'var(--touch-target)',
                  width: '100%',
                }}
              >
                찜 해제
              </button>
            </Box>
          ))}
        </SimpleGrid>
      )}
    </Container>
  );
}
