'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Box } from '@mantine/core';
import type { Product } from '@greenhub/shared';

const DEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000;

function useCountdown(deadline: string | undefined) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setLabel('마감');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLabel(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  return label;
}

function DeadlineCard({ product }: { product: Product }) {
  const deadline = product.groupSummary?.recruitDeadline;
  const countdown = useCountdown(deadline);
  const { currentQuantity, targetQuantity } = product.groupSummary!;
  const pct = Math.min((currentQuantity / targetQuantity) * 100, 100);

  return (
    <Box
      component={Link}
      href={`/products/${product.id}`}
      style={{ textDecoration: 'none', flexShrink: 0, width: 140 }}
    >
      <Box
        style={{
          aspectRatio: '4/5',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          background: 'var(--color-border)',
          position: 'relative',
          marginBottom: 6,
        }}
      >
        <Image
          fill
          src={product.images?.[0] ?? '/icons/icon-192x192.png'}
          alt={product.name}
          sizes="140px"
          style={{ objectFit: 'cover' }}
        />
        <Box
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '4px 8px',
            background: 'rgba(0,0,0,0.55)',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-bg)',
              fontFamily: 'monospace',
            }}
          >
            {countdown}
          </span>
        </Box>
      </Box>

      <p
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--color-text)',
          margin: '0 0 4px',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {product.name}
      </p>

      <Box
        style={{
          height: 4,
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <Box
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--color-primary)',
            borderRadius: 'var(--radius-full)',
          }}
        />
      </Box>
      <p
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-primary)',
          marginTop: 2,
          marginBottom: 0,
          fontWeight: 'var(--fw-medium)',
        }}
      >
        {currentQuantity}/{targetQuantity}개
      </p>
    </Box>
  );
}

interface DeadlineSectionProps {
  products: Product[];
}

export default function DeadlineSection({ products }: DeadlineSectionProps) {
  const soon = products.filter((p) => {
    const dl = p.groupSummary?.recruitDeadline;
    if (!dl) return false;
    const diff = new Date(dl).getTime() - Date.now();
    return diff > 0 && diff < DEADLINE_WINDOW_MS;
  });

  if (soon.length === 0) return null;

  return (
    <Box mb="xl">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-text)',
            }}
          >
            🔥 마감 임박
          </span>
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-bg)',
              background: 'var(--color-danger)',
              borderRadius: 'var(--radius-full)',
              padding: '1px 7px',
            }}
          >
            {soon.length}
          </span>
        </div>
      </div>

      <Box
        style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          paddingBottom: 4,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {soon.map((p) => (
          <DeadlineCard key={p.id} product={p} />
        ))}
      </Box>
    </Box>
  );
}
