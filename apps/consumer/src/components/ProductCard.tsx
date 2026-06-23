'use client';

import type { Product, ProductSummary } from '@greenhub/shared';
import { getGroupBuyStatus } from '@greenhub/shared';
import { Box, Card, Progress } from '@mantine/core';
import Image from 'next/image';
import Link from 'next/link';
import type React from 'react';

type ProductCardVariant = 'compact' | 'discovery' | 'store';

interface ProductCardProps {
  product: Product | ProductSummary;
  href?: string;
  variant?: ProductCardVariant;
}

const categoryLabels: Record<string, string> = {
  cut_flower: '절화',
  orchid: '난',
  foliage: '관엽',
};

const variantConfig: Record<
  ProductCardVariant,
  {
    imageRatio: string;
    imageSizes: string;
    padding: string;
    showColors: boolean;
    groupMode: 'full' | 'summary';
  }
> = {
  compact: {
    imageRatio: '4/5',
    imageSizes: '(max-width: 600px) 50vw, 33vw',
    padding: 'xs',
    showColors: true,
    groupMode: 'full',
  },
  discovery: {
    imageRatio: '1/1',
    imageSizes: '(max-width: 600px) 50vw, 33vw',
    padding: 'xs',
    showColors: true,
    groupMode: 'full',
  },
  store: {
    imageRatio: '1/1',
    imageSizes: '(max-width: 600px) 50vw, 240px',
    padding: '8px',
    showColors: false,
    groupMode: 'summary',
  },
};

function formatDeadline(value: Date | string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const diff = date.getTime() - Date.now();
  if (diff <= 0) return '마감';

  const hours = Math.ceil(diff / (1000 * 60 * 60));
  if (hours < 24) return `${hours}시간 남음`;
  return `${Math.ceil(hours / 24)}일 남음`;
}

function getProductColors(product: Product | ProductSummary) {
  return 'selection' in product
    ? (product.selection?.colors ?? product.colors ?? [])
    : (product.colors ?? []);
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'neutral' | 'primary' }) {
  return (
    <span
      style={{
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--fw-medium)',
        color: tone === 'primary' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
        background: tone === 'primary' ? 'var(--color-primary-surface)' : 'var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '1px 8px',
      }}
    >
      {children}
    </span>
  );
}

function ColorSummary({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;

  return (
    <p
      style={{
        fontSize: 'var(--font-size-sm)',
        color: 'var(--color-text-disabled)',
        marginTop: 4,
        marginBottom: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {colors.slice(0, 3).join(' · ')}
      {colors.length > 3 && ` +${colors.length - 3}`}
    </p>
  );
}

function GroupBuySummary({
  product,
  mode,
}: {
  product: Product | ProductSummary;
  mode: 'full' | 'summary';
}) {
  if (product.saleType !== 'group') return null;

  const status = getGroupBuyStatus(product.groupSummary);
  const deadlineText = formatDeadline(status.deadline);
  const muted = !status.canParticipate;
  const progressLabel =
    status.targetQuantity > 0
      ? `${status.currentQuantity}/${status.targetQuantity}개`
      : '수량 확인 필요';
  const summaryText = status.canParticipate
    ? `${progressLabel} 모집 중 · ${status.remainingToTarget}개 남음`
    : status.label;

  return (
    <>
      <Progress
        value={status.targetProgress}
        size="sm"
        mt={6}
        radius="xl"
        aria-label={`공동구매 진행률 ${Math.round(status.targetProgress)}%`}
        style={
          {
            '--progress-color': muted ? 'var(--color-text-disabled)' : 'var(--color-primary)',
          } as React.CSSProperties
        }
      />
      <p
        style={{
          fontSize: 'var(--font-size-sm)',
          color: muted ? 'var(--color-text-disabled)' : 'var(--color-primary)',
          marginTop: 2,
          marginBottom: 0,
          fontWeight: 'var(--fw-medium)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: mode === 'summary' ? 'nowrap' : 'normal',
        }}
      >
        {summaryText}
      </p>
      {mode === 'full' && (
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
            marginTop: 2,
            marginBottom: 0,
          }}
        >
          최소 {status.minQuantity}개{deadlineText ? ` · ${deadlineText}` : ''}
        </p>
      )}
    </>
  );
}

export default function ProductCard({ product, href, variant = 'compact' }: ProductCardProps) {
  const imgSrc = product.images?.[0] ?? '/icons/icon-192x192.png';
  const config = variantConfig[variant];
  const colors = getProductColors(product);
  const categoryLabel = categoryLabels[product.category] ?? product.category;
  const saleLabel = product.saleType === 'group' ? '공동구매' : '일반상품';

  return (
    <Card
      component={Link}
      href={href ?? `/products/${product.id}`}
      p={0}
      aria-label={`${product.name}, ${categoryLabel}, ${saleLabel}, ${product.price.toLocaleString()}원`}
      data-product-card-variant={variant}
      style={{
        overflow: 'hidden',
        display: 'block',
        textDecoration: 'none',
        border: 'var(--border)',
      }}
    >
      <Box
        style={{
          position: 'relative',
          aspectRatio: config.imageRatio,
          background: 'var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <Image
          fill
          src={imgSrc}
          alt={product.name}
          sizes={config.imageSizes}
          style={{ objectFit: 'cover' }}
        />
      </Box>

      <Box p={config.padding}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
          <Badge tone="neutral">{categoryLabel}</Badge>
          {product.saleType === 'group' && <Badge tone="primary">공동구매</Badge>}
        </div>
        <p
          style={{
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--color-text)',
            margin: 0,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {product.name}
        </p>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-text-secondary)',
            marginTop: 4,
            marginBottom: 0,
          }}
        >
          {product.price.toLocaleString()}원
        </p>
        {config.showColors && <ColorSummary colors={colors} />}
        <GroupBuySummary product={product} mode={config.groupMode} />
      </Box>
    </Card>
  );
}
