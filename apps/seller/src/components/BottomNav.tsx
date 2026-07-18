'use client';

import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const SELLER_BOTTOM_NAV_ITEMS = [
  { href: '/orders', label: '주문', icon: OrderIcon },
  { href: '/sale-rounds', label: '회차', icon: SaleRoundIcon },
  { href: '/products', label: '상품', icon: ProductIcon },
  { href: '/prep', label: '준비', icon: PrepIcon },
  { href: '/settings', label: '설정', icon: SettingsIcon },
] as const;

export function isBottomNavItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function BottomNav() {
  const pathname = usePathname();

  const hiddenPaths = ['/login', '/onboarding'];
  if (hiddenPaths.some((p) => pathname.startsWith(p))) return null;

  return (
    <Box
      component="nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        backgroundColor: 'var(--color-bg)',
        boxShadow: '0 -2px 12px rgba(0,0,0,0.08)',
        height: 'calc(64px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <Box style={{ maxWidth: 480, width: '100%', display: 'flex' }}>
        {SELLER_BOTTOM_NAV_ITEMS.map((tab) => {
          const isActive = isBottomNavItemActive(pathname, tab.href);
          const Icon = tab.icon;

          return (
            <UnstyledButton
              key={tab.href}
              component={Link}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              style={{ flex: 1 }}
            >
              <Stack align="center" justify="center" gap={2} h="100%">
                <Icon active={isActive} />
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-medium)',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-disabled)',
                  }}
                >
                  {tab.label}
                </Text>
              </Stack>
            </UnstyledButton>
          );
        })}
      </Box>
    </Box>
  );
}

// ─── Icons (inline SVG) ──────────────────────────────────────────

function OrderIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-primary)' : 'var(--color-text-disabled)';
  const sw = active ? 2.2 : 2;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function ProductIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-primary)' : 'var(--color-text-disabled)';
  const sw = active ? 2.2 : 2;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
}

function SaleRoundIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-primary)' : 'var(--color-text-disabled)';
  const sw = active ? 2.2 : 2;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 9h18" />
      <path d="M8 13h3M13 13h3M8 17h3" />
    </svg>
  );
}

function PrepIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-primary)' : 'var(--color-text-disabled)';
  const sw = active ? 2.2 : 2;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-primary)' : 'var(--color-text-disabled)';
  const sw = active ? 2.2 : 2;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
