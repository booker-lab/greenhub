'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Box, UnstyledButton, Stack, Text } from '@mantine/core'
import { useCart } from '@/hooks/useCart'

const tabs = [
  { href: '/', label: '홈', icon: HomeIcon, showBadge: false },
  { href: '/category', label: '카테고리', icon: CategoryIcon, showBadge: false },
  { href: '/search', label: '검색', icon: SearchIcon, showBadge: false },
  { href: '/cart', label: '장바구니', icon: CartIcon, showBadge: true },
  { href: '/mypage', label: 'MY', icon: MyIcon, showBadge: false },
] as const

export default function BottomNav() {
  const pathname = usePathname()
  const { itemCount } = useCart()

  const hiddenPaths = ['/login', '/checkout', '/order/success']
  if (hiddenPaths.some((p) => pathname.startsWith(p))) return null

  return (
    <Box
      component="nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: 'var(--mantine-color-white)',
        borderTop: '1px solid var(--mantine-color-gray-2)',
        height: 'calc(64px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex',
      }}
    >
      {tabs.map((tab) => {
        const isActive =
          tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
        const Icon = tab.icon

        return (
          <UnstyledButton
            key={tab.href}
            component={Link}
            href={tab.href}
            style={{ flex: 1 }}
          >
            <Stack align="center" justify="center" gap={2} h="100%" style={{ position: 'relative' }}>
              <Box style={{ position: 'relative', display: 'inline-flex' }}>
                <Icon active={isActive} />
                {tab.showBadge && itemCount > 0 && (
                  <Box
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -10,
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
              </Box>
              <Text size="xs" fw={500} c={isActive ? 'brand.6' : 'gray.4'}>
                {tab.label}
              </Text>
            </Stack>
          </UnstyledButton>
        )
      })}
    </Box>
  )
}

// ─── Icons (inline SVG) ──────────────────────────────────────────

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--green-primary)' : '#9CA3AF'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function CategoryIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--green-primary)' : '#9CA3AF'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  )
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--green-primary)' : '#9CA3AF'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function CartIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--green-primary)' : '#9CA3AF'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  )
}

function MyIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--green-primary)' : '#9CA3AF'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
