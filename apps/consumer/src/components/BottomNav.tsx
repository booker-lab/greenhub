'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Box, UnstyledButton, Stack, Text } from '@mantine/core'
import { Home, LayoutGrid, Users, ShoppingCart, User } from 'lucide-react'
import { useCart } from '@/hooks/useCart'

const tabs = [
  { href: '/', label: '홈', Icon: Home, showBadge: false },
  { href: '/category', label: '카테고리', Icon: LayoutGrid, showBadge: false },
  { href: '/groupbuy', label: '공구', Icon: Users, showBadge: false },
  { href: '/cart', label: '장바구니', Icon: ShoppingCart, showBadge: true },
  { href: '/mypage', label: 'MY', Icon: User, showBadge: false },
] as const

export default function BottomNav() {
  const pathname = usePathname()
  const { itemCount } = useCart()

  const hiddenPaths = ['/checkout', '/order/success', '/products/']
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
        backgroundColor: 'var(--color-bg)',
        borderTop: 'var(--border)',
        height: 'calc(64px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <Box style={{ display: 'flex', maxWidth: 430, margin: '0 auto', height: '100%' }}>
        {tabs.map((tab) => {
          const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
          const { Icon } = tab

          return (
            <UnstyledButton key={tab.href} component={Link} href={tab.href} style={{ flex: 1 }}>
              <Stack align="center" justify="center" gap={2} h="100%" style={{ position: 'relative' }}>
                <Box style={{ position: 'relative', display: 'inline-flex' }}>
                  <Icon
                    size={24}
                    strokeWidth={isActive ? 2.2 : 1.8}
                    color={isActive ? 'var(--color-primary)' : 'var(--color-text-disabled)'}
                  />
                  {tab.showBadge && itemCount > 0 && (
                    <Box style={{
                      position: 'absolute',
                      top: -6,
                      right: -10,
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
                    }}>
                      {itemCount > 99 ? '99+' : itemCount}
                    </Box>
                  )}
                </Box>
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: isActive ? 'var(--fw-bold)' : 'var(--fw-medium)',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-disabled)',
                  }}
                >
                  {tab.label}
                </Text>
              </Stack>
            </UnstyledButton>
          )
        })}
      </Box>
    </Box>
  )
}
