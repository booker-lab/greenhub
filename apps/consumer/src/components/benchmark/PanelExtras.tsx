'use client';

import type { Product, SaleRoundItem } from '@greenhub/shared';
import { Group, Text } from '@mantine/core';
import { useProductReviews } from '@/hooks/useBenchmark';
import { priceDropFromPreviousRound, previousRoundDropLabel } from '@/lib/benchmark-format';
import { isFeatureOn } from '@/lib/features';

// 상세 회차 가격 아래 지난 회차 대비 가격(card-discount)과 별점 요약(reviews).
export default function PanelExtras({ product, item }: { product: Product; item: SaleRoundItem }) {
  const reviews = useProductReviews(product.id, isFeatureOn('reviews'));
  const drop = isFeatureOn('card-discount')
    ? priceDropFromPreviousRound(item.previousRoundPrice, item.roundPrice)
    : null;
  const summary = reviews?.summary;
  if (!drop && !(summary && summary.count > 0)) return null;
  return (
    <Group gap={10} px="md" pt={4}>
      {drop && (
        <Text size="sm" fw={800} c="var(--color-primary-dark)">
          {previousRoundDropLabel(drop)}
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
