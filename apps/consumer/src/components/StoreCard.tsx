'use client';

import type { PublicStoreSummary } from '@greenhub/shared';
import { Box, Card, Group, Stack, Text } from '@mantine/core';
import { MapPin, Package, Store } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

interface StoreCardProps {
  store: PublicStoreSummary;
  compact?: boolean;
}

export default function StoreCard({ store, compact = false }: StoreCardProps) {
  const imageSize = compact ? 64 : 84;

  return (
    <Card
      component={Link}
      href={`/stores/${store.id}`}
      p="sm"
      style={{ border: 'var(--border)', textDecoration: 'none' }}
    >
      <Group wrap="nowrap" align={compact ? 'center' : 'stretch'}>
        <Box
          style={{
            position: 'relative',
            width: imageSize,
            height: compact ? imageSize : 'auto',
            minHeight: imageSize,
            flex: `0 0 ${imageSize}px`,
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            background: 'var(--color-border)',
          }}
        >
          <Image
            fill
            src={store.logoUrl ?? '/icons/icon-192x192.png'}
            alt={store.name || '상점 로고'}
            sizes={`${imageSize}px`}
            style={{ objectFit: 'cover' }}
          />
        </Box>
        <Stack gap={compact ? 5 : 6} style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            {compact && <Store size={15} color="var(--color-primary)" />}
            <Text
              lineClamp={1}
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              {store.name || '이름 없는 상점'}
            </Text>
          </Group>
          <Group gap={6} wrap="nowrap">
            <MapPin size={14} color="var(--color-text-disabled)" />
            <Text
              lineClamp={1}
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {store.address || '주소 미등록'}
            </Text>
          </Group>
          <Group gap={compact ? 6 : 'xs'} wrap="nowrap">
            {compact && <Package size={14} color="var(--color-text-disabled)" />}
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}>
              상품 {store.productCount}개
            </Text>
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                color: compact ? 'var(--color-primary)' : 'var(--color-text-disabled)',
              }}
            >
              {compact ? `· 거점 ${store.hubCount}곳` : `거점 ${store.hubCount}곳`}
            </Text>
          </Group>
        </Stack>
        {!compact && <Package size={18} color="var(--color-text-disabled)" />}
      </Group>
    </Card>
  );
}
