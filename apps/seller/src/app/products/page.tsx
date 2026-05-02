'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import type { Product } from '@greenhub/shared';
import {
  Badge,
  Box,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';

type ProductFilter = 'all' | 'active' | 'inactive';

const CATEGORY_LABEL: Record<string, string> = {
  cut_flower: '절화',
  orchid: '난',
  foliage: '관엽',
};

export default function ProductsPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const { products, loading } = useStoreProducts(storeId);
  const [filter, setFilter] = useState<ProductFilter>('all');

  const filtered = products.filter((p) => {
    if (filter === 'active') return p.isActive;
    if (filter === 'inactive') return !p.isActive;
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
            <Title order={3}>상품 관리</Title>
            <Button
              component={Link}
              href="/products/new"
              size="xs"
              radius="md"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              + 등록
            </Button>
          </Group>
        </Container>
      </Box>

      {/* 필터 탭 */}
      <Box
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Container size="sm">
          <Group gap={0}>
            {(['all', 'active', 'inactive'] as ProductFilter[]).map((f) => (
              <UnstyledButton
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-medium)',
                  textAlign: 'center',
                  borderBottom: `2px solid ${filter === f ? 'var(--color-primary)' : 'transparent'}`,
                  color: filter === f ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                }}
              >
                {f === 'all'
                  ? `전체 ${products.length}`
                  : f === 'active'
                    ? `판매 중 ${products.filter((p) => p.isActive).length}`
                    : `비활성 ${products.filter((p) => !p.isActive).length}`}
              </UnstyledButton>
            ))}
          </Group>
        </Container>
      </Box>

      {/* 상품 목록 */}
      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          {loading && (
            <Group justify="center" py={80}>
              <Loader size="sm" color="var(--color-primary)" />
            </Group>
          )}

          {!loading && filtered.length === 0 && (
            <Stack
              align="center"
              justify="center"
              py={80}
              style={{ color: 'var(--color-text-disabled)' }}
            >
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              </svg>
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>등록된 상품이 없습니다</Text>
              <Text
                component={Link}
                href="/products/new"
                mt="xs"
                style={{
                  color: 'var(--color-primary)',
                  fontWeight: 'var(--fw-medium)',
                  fontSize: 'var(--font-size-md)',
                }}
              >
                상품 등록하기 →
              </Text>
            </Stack>
          )}

          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} storeId={storeId} />
          ))}
        </Stack>
      </Container>
    </Box>
  );
}

function ProductCard({ product, storeId }: { product: Product; storeId: string | null }) {
  const { data: session } = useSession();
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleToggleActive() {
    setToggling(true);
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/products/${product.id}/active`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.user.accessToken}`,
          },
          body: JSON.stringify({ isActive: !product.isActive }),
        },
      );
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`"${product.name}" 상품을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`))
      return;
    setDeleting(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/products/${product.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.user.accessToken}` },
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Group gap="sm" align="flex-start">
        {/* 이미지 */}
        <Box
          style={{
            width: 64,
            height: 64,
            borderRadius: 12,
            backgroundColor: 'var(--color-surface-muted)',
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {product.images[0] ? (
            <Image
              fill
              src={product.images[0]}
              alt={product.name}
              sizes="64px"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <Box style={{ color: 'var(--color-text-disabled)' }}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </Box>
          )}
        </Box>

        {/* 정보 */}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }} truncate>
            {product.name}
          </Text>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            mt={2}
          >
            {CATEGORY_LABEL[product.category]} · ₩{product.price.toLocaleString()}
            {product.saleType === 'group' && ' · 공동구매'}
          </Text>
          <Group gap="xs" mt="xs">
            {/* 활성/비활성 토글 */}
            <Badge
              component="button"
              onClick={handleToggleActive}
              style={{ cursor: toggling ? 'not-allowed' : 'pointer' }}
              color={product.isActive ? 'green' : 'gray'}
              variant="light"
              radius="xl"
              size="md"
            >
              {product.isActive ? '판매 중' : '비활성'}
            </Badge>
            <Badge
              component={Link}
              href={`/products/${product.id}/edit`}
              color="gray"
              variant="light"
              radius="xl"
              size="md"
              style={{ cursor: 'pointer' }}
            >
              수정
            </Badge>
            <Badge
              component="button"
              onClick={handleDelete}
              style={{ cursor: deleting ? 'not-allowed' : 'pointer' }}
              color="red"
              variant="light"
              radius="xl"
              size="md"
            >
              {deleting ? '삭제 중...' : '삭제'}
            </Badge>
          </Group>
        </Box>
      </Group>
    </Paper>
  );
}
