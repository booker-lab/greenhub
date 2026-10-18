'use client';

import type { Product, SaleRoundItem } from '@greenhub/shared';
import { Group, Text } from '@mantine/core';
import { useProductReviews } from '@/hooks/useBenchmark';
import { discountRate } from '@/lib/benchmark-format';
import { isFeatureOn } from '@/lib/features';

// 상세 회차 가격 옆 할인율(card-discount)과 별점 요약(reviews).
export default function PanelExtras({ product, item }: { product: Product; item: SaleRoundItem }) {
  const reviews = useProductReviews(product.id, isFeatureOn('reviews'));
  const rate = isFeatureOn('card-discount') ? discountRate(product.listPrice, item.roundPrice) : null;
  const summary = reviews?.summary;
  if (!rate && !(summary && summary.count > 0)) return null;
  return (
    <Group gap={10} px="md" pt={4}>
      {rate && product.listPrice && (
        <Text size="sm">
          <Text span fw={800} c="var(--color-primary-dark)">
            {rate}% 할인
          </Text>{' '}
          <Text span c="var(--color-text-disabled)" td="line-through">
            {product.listPrice.toLocaleString()}원
          </Text>
        </Text>
      )}
      {summary && summary.count > 0 && (
        <a href="#reviews-title" style={{ color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', fontWeight: 700 }}>
          <span aria-hidden style={{ color: '#F5A524' }}>
            ★
          </span>{' '}
          {summary.average.toFixed(1)} · 후기 {summary.count}
        </a>
      )}
    </Group>
  );
}
