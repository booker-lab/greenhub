'use client'

import { useRouter } from 'next/navigation'
import { Box, Text } from '@mantine/core'
import { useCart } from '@/hooks/useCart'

export default function ProductTopBar() {
  const router = useRouter()
  const { itemCount } = useCart()

  return (
    <Box
      component="header"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: 'var(--mantine-color-white)',
        boxShadow: '0 1px 8px rgba(0,0,0,0.08)',
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
          paddingLeft: 8,
          paddingRight: 12,
        }}
      >
        {/* 뒤로가기 */}
        <button
          onClick={() => router.back()}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: 'var(--mantine-color-dark-6)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <Text size="sm" fw={500} c="dark.6">뒤로</Text>
        </button>

        {/* 로고 */}
        <Text
          fw={800}
          size="lg"
          style={{ letterSpacing: '-0.5px', color: 'var(--green-primary)' }}
        >
          Green Love
        </Text>

        {/* 홈 + 장바구니 */}
        <Box style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => router.push('/')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center' }}
            aria-label="홈으로"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>

          <button
            onClick={() => router.push('/cart')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', position: 'relative' }}
            aria-label="장바구니"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {itemCount > 0 && (
              <Box
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 99,
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
  )
}
