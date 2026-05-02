'use client';

import { useRouter } from 'next/navigation';
import { Box } from '@mantine/core';
import { ChevronLeft, Home, ShoppingCart } from 'lucide-react';
import { useCart } from '@/hooks/useCart';

export default function ProductTopBar() {
  const router = useRouter();
  const { itemCount } = useCart();

  return (
    <Box
      component="header"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: 'var(--color-bg)',
        borderBottom: 'var(--border)',
        height: 'calc(52px + env(safe-area-inset-top))',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: 430,
          margin: '0 auto',
          height: 52,
          paddingLeft: 4,
          paddingRight: 8,
        }}
      >
        {/* 뒤로가기 */}
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            minWidth: 'var(--touch-target)',
            minHeight: 'var(--touch-target)',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            color: 'var(--color-text)',
            padding: '0 8px',
          }}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
          <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-medium)' }}>
            뒤로
          </span>
        </button>

        {/* 로고 */}
        <span
          style={{
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--fw-bold)',
            letterSpacing: '-0.5px',
            color: 'var(--color-primary)',
          }}
        >
          Green Love
        </span>

        {/* 홈 + 장바구니 */}
        <Box style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => router.push('/')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              minWidth: 'var(--touch-target)',
              minHeight: 'var(--touch-target)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-secondary)',
            }}
            aria-label="홈으로"
          >
            <Home size={22} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={() => router.push('/cart')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              minWidth: 'var(--touch-target)',
              minHeight: 'var(--touch-target)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              color: 'var(--color-text-secondary)',
            }}
            aria-label="장바구니"
          >
            <ShoppingCart size={22} strokeWidth={1.8} />
            {itemCount > 0 && (
              <Box
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 4,
                  background: 'var(--color-danger)',
                  color: 'var(--color-bg)',
                  fontSize: 10,
                  fontWeight: 'var(--fw-bold)',
                  minWidth: 16,
                  height: 16,
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                {itemCount > 99 ? '99+' : itemCount}
              </Box>
            )}
          </button>
        </Box>
      </Box>
    </Box>
  );
}
