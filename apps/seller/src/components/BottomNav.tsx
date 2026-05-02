'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Box, UnstyledButton, Stack, Text } from '@mantine/core';

const tabs = [
  { href: '/orders', label: '주문', icon: OrderIcon },
  { href: '/products', label: '상품', icon: ProductIcon },
  { href: '/settlements', label: '정산', icon: SettlementIcon },
  { href: '/hubs', label: '거점', icon: HubIcon },
  { href: '/settings', label: '설정', icon: SettingsIcon },
] as const;

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
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          const Icon = tab.icon;

          return (
            <UnstyledButton key={tab.href} component={Link} href={tab.href} style={{ flex: 1 }}>
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
    >
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
}

function SettlementIcon({ active }: { active: boolean }) {
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
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function HubIcon({ active }: { active: boolean }) {
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
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
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
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
