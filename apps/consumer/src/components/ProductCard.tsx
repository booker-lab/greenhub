'use client';

import type React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Card, Box, Progress } from '@mantine/core';
import { getGroupBuyStatus, type Product } from '@greenhub/shared';

interface ProductCardProps {
  product: Product;
}

const categoryLabels: Record<string, string> = {
  cut_flower: '절화',
  orchid: '난',
  foliage: '관엽',
};

export default function ProductCard({ product }: ProductCardProps) {
  const imgSrc = product.images?.[0] ?? '/icons/icon-192x192.png';

  return (
    <Card
      component={Link}
      href={`/products/${product.id}`}
      p={0}
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
          aspectRatio: '4/5',
          background: 'var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <Image
          fill
          src={imgSrc}
          alt={product.name}
          sizes="(max-width: 600px) 50vw, 33vw"
          style={{ objectFit: 'cover' }}
        />
      </Box>

      <Box p="xs">
        <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 8px',
            }}
          >
            {categoryLabels[product.category] ?? product.category}
          </span>
          {product.saleType === 'group' && (
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
              공동구매
            </span>
          )}
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
        {(() => {
          const colors = product.selection?.colors ?? product.colors ?? [];
          return colors.length > 0 ? (
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
          ) : null;
        })()}
        {product.saleType === 'group' &&
          product.groupSummary &&
          (() => {
            const { currentQuantity, targetQuantity } = product.groupSummary;
            const pct = Math.min((currentQuantity / targetQuantity) * 100, 100);
            const status = getGroupBuyStatus(product.groupSummary);
            const done = status !== 'open';
            const statusLabel =
              status === 'full'
                ? '모집 완료'
                : status === 'expired'
                  ? '모집 마감'
                  : status === 'unavailable'
                    ? '판매 준비 중'
                    : `${currentQuantity}/${targetQuantity}개 모집 중`;
            return (
              <>
                <Progress
                  value={pct}
                  size="sm"
                  mt={6}
                  radius="xl"
                  style={
                    {
                      '--progress-color': done
                        ? 'var(--color-text-disabled)'
                        : 'var(--color-primary)',
                    } as React.CSSProperties
                  }
                />
                <p
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: done ? 'var(--color-text-disabled)' : 'var(--color-primary)',
                    marginTop: 2,
                    marginBottom: 0,
                    fontWeight: 'var(--fw-medium)',
                  }}
                >
                  {statusLabel}
                </p>
              </>
            );
          })()}
      </Box>
    </Card>
  );
}
