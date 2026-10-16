'use client';

import {
  LIGHT_LABELS,
  PLACEMENT_LABELS,
  type Product,
  type SaleRoundItem,
} from '@greenhub/shared';
import { Box, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { useProductReviews, useStoreProfile } from '@/hooks/useBenchmark';
import { useProducts } from '@/hooks/useProducts';
import type { PublicSaleRound } from '@/hooks/useSaleRounds';
import { sizeRows } from '@/lib/benchmark-format';
import { isFeatureOn } from '@/lib/features';

// 상품 상세의 벤치마킹 비교 기능 묶음(품질 보장·크기·관리 안내·생산자 소개·후기·비슷한 꽃).
// 각 칸은 기능 토글이 켜져 있고 보여줄 값이 있을 때만 그린다.

const sectionTitle = {
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--fw-extrabold)',
  margin: 0,
} as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-labelledby={id} pt="lg" style={{ borderTop: 'var(--border)' }}>
      <h2 id={id} style={sectionTitle}>
        {title}
      </h2>
      <Box mt="sm">{children}</Box>
    </Box>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Stack gap={6}>
      {rows.map(([label, value]) => (
        <Box
          key={label}
          style={{
            borderBottom: '1px solid var(--color-surface-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            paddingBottom: 6,
          }}
        >
          <Text size="sm" c="var(--color-text-secondary)">
            {label}
          </Text>
          <Text size="sm" fw={700}>
            {value}
          </Text>
        </Box>
      ))}
    </Stack>
  );
}

function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span aria-label={`별점 ${value.toFixed(1)}점`} style={{ color: '#F5A524', letterSpacing: 1 }}>
      {'★'.repeat(full)}
      <span style={{ color: 'var(--color-border)' }}>{'★'.repeat(5 - full)}</span>
    </span>
  );
}

export function ReviewsSection({ productId }: { productId: string }) {
  const reviews = useProductReviews(productId, isFeatureOn('reviews'));
  const [expanded, setExpanded] = useState(false);
  if (!isFeatureOn('reviews') || !reviews) return null;
  const shown = expanded ? reviews.items : reviews.items.slice(0, 3);
  return (
    <Section id="reviews-title" title={`후기 ${reviews.summary.count}`}>
      {reviews.summary.count === 0 ? (
        <Text size="sm" c="var(--color-text-secondary)">
          아직 후기가 없어요. 배송을 받은 뒤 MY 주문 내역에서 첫 후기를 남겨 주세요.
        </Text>
      ) : (
        <Stack gap="md">
          <Text size="lg" fw={800}>
            <Stars value={reviews.summary.average} /> {reviews.summary.average.toFixed(1)}
          </Text>
          {shown.map((review) => (
            <Box key={review.id} style={{ borderBottom: '1px solid var(--color-surface-muted)', paddingBottom: 12 }}>
              <Text size="sm" fw={700}>
                <Stars value={review.rating} /> {review.authorName}
                <Text span size="sm" fw={400} c="var(--color-text-secondary)">
                  {' '}
                  · {review.createdAt.slice(0, 10).replace(/-/g, '.')}
                </Text>
              </Text>
              <Text size="sm" mt={4} style={{ whiteSpace: 'pre-line' }}>
                {review.text}
              </Text>
            </Box>
          ))}
          {reviews.items.length > 3 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                background: 'var(--color-surface-muted)',
                border: 0,
                borderRadius: 'var(--radius-full)',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 700,
                minHeight: 'var(--touch-target)',
              }}
            >
              {expanded ? '접기' : `후기 ${reviews.items.length - 3}개 더 보기`}
            </button>
          )}
        </Stack>
      )}
    </Section>
  );
}

function Recommendations({ product, round }: { product: Product; round: PublicSaleRound }) {
  const { products } = useProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const sameCare = (other: Product | undefined) =>
    !!other &&
    ((product.light && other.light === product.light) ||
      (product.selection?.careLevel && other.selection?.careLevel === product.selection.careLevel));
  const candidates = round.items
    .filter((item) => item.productId !== product.id && item.status !== 'HIDDEN')
    .sort((a, b) => Number(sameCare(byId.get(b.productId))) - Number(sameCare(byId.get(a.productId))))
    .slice(0, 4);
  if (candidates.length === 0) return null;
  return (
    <Section id="recommend-title" title="이번 회차 비슷한 꽃">
      <Box style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {candidates.map((item: SaleRoundItem) => (
          <Link
            key={item.id}
            href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(round.id)}`}
            style={{
              background: 'var(--color-surface-muted)',
              borderRadius: 'var(--radius-sm)',
              color: 'inherit',
              padding: 12,
              textDecoration: 'none',
            }}
          >
            <Text size="sm" fw={700} lineClamp={2}>
              {item.productNameSnapshot}
            </Text>
            <Text size="sm" fw={800} mt={2}>
              {item.roundPrice.toLocaleString()}원
            </Text>
            {sameCare(byId.get(item.productId)) && (
              <Text size="sm" c="var(--color-primary-dark)" fw={700} mt={2}>
                같은 관리 조건
              </Text>
            )}
          </Link>
        ))}
      </Box>
    </Section>
  );
}

export default function DetailExtras({
  product,
  round,
}: {
  product: Product;
  round: PublicSaleRound | null;
}) {
  const store = useStoreProfile(
    product.storeId,
    isFeatureOn('seller-store') || isFeatureOn('quality-guarantee'),
  );
  const guarantee =
    isFeatureOn('quality-guarantee') && product.guaranteed && store?.guarantee?.enabled
      ? store.guarantee
      : null;
  const size = isFeatureOn('size-info') ? sizeRows(product.size) : [];
  const placeRows: Array<[string, string]> = [];
  if (isFeatureOn('size-info') && product.light) placeRows.push(['빛', LIGHT_LABELS[product.light]]);
  if (isFeatureOn('size-info') && product.placements?.length) {
    placeRows.push(['어울리는 곳', product.placements.map((p) => PLACEMENT_LABELS[p]).join(', ')]);
  }
  const care = isFeatureOn('care-guide') ? product.careGuide : undefined;
  const producer = isFeatureOn('seller-store') && store && (store.intro || store.story) ? store : null;

  return (
    <Stack gap="lg" px="md" pb="lg">
      {guarantee && (
        <Box
          component="section"
          aria-labelledby="guarantee-title"
          p="md"
          style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}
        >
          <h2 id="guarantee-title" style={{ ...sectionTitle, color: 'var(--color-primary-dark)' }}>
            {guarantee.title}
          </h2>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {guarantee.terms.map((term) => (
              <li key={term} style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                {term}
              </li>
            ))}
          </ul>
          <Link href="/guarantee" style={{ color: 'var(--color-primary-dark)', fontSize: 'var(--font-size-sm)', fontWeight: 700 }}>
            보장 상품 모아보기 →
          </Link>
        </Box>
      )}

      {(size.length > 0 || placeRows.length > 0) && (
        <Section id="size-title" title="크기와 어울리는 곳">
          <Rows rows={[...size, ...placeRows]} />
          <Text size="sm" c="var(--color-text-secondary)" mt={8}>
            경매에서 고른 같은 품종이라 실물 크기는 조금 다를 수 있어요.
          </Text>
        </Section>
      )}

      {care && (
        <Section id="care-title" title="이렇게 키워 주세요">
          <Box style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {(
              [
                ['💧', '물 주기', care.watering],
                ['☀️', '빛', care.light],
                ['🌡️', '온도', care.temperature],
                ['🪴', '분갈이', care.repotting],
              ] as const
            ).map(([icon, label, text]) => (
              <Box key={label} p="sm" style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)' }}>
                <Text size="sm" fw={800}>
                  <span aria-hidden>{icon}</span> {label}
                </Text>
                <Text size="sm" mt={4} c="var(--color-text-secondary)">
                  {text}
                </Text>
              </Box>
            ))}
          </Box>
        </Section>
      )}

      {producer && (
        <Section id="producer-title" title="누가 골랐나요">
          <Text size="sm" fw={800}>
            {producer.name}
            {producer.region ? ` · ${producer.region}` : ''}
            {producer.sinceYear ? ` · ${producer.sinceYear}년부터` : ''}
          </Text>
          {producer.intro && (
            <Text size="sm" mt={4}>
              {producer.intro}
            </Text>
          )}
          {producer.story && (
            <Text size="sm" mt={8} c="var(--color-text-secondary)" lineClamp={4} style={{ whiteSpace: 'pre-line' }}>
              {producer.story}
            </Text>
          )}
          <Link
            href={`/store/${encodeURIComponent(product.storeId)}`}
            style={{ color: 'var(--color-primary-dark)', display: 'inline-block', fontSize: 'var(--font-size-sm)', fontWeight: 700, marginTop: 8 }}
          >
            판매자 화면 보기 →
          </Link>
        </Section>
      )}

      <ReviewsSection productId={product.id} />

      {isFeatureOn('recommendations') && round && <Recommendations product={product} round={round} />}
    </Stack>
  );
}
