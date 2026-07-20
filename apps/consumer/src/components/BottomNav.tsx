'use client';

import type { Product, SalesMode } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { doc, getDoc } from 'firebase/firestore';
import { Home, LayoutGrid, ShoppingCart, User, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useCart } from '@/hooks/useCart';
import { useProducts } from '@/hooks/useProducts';
import { db } from '@/lib/firebase';

const ROUND_DIRECT_TABS = [
  { href: '/', label: '홈', Icon: Home, showBadge: false },
  { href: '/category', label: '상품', Icon: LayoutGrid, showBadge: false },
  { href: '/cart', label: '장바구니', Icon: ShoppingCart, showBadge: true },
  { href: '/mypage', label: 'MY', Icon: User, showBadge: false },
] as const;

const LEGACY_TABS = [
  { href: '/', label: '홈', Icon: Home, showBadge: false },
  { href: '/category', label: '카테고리', Icon: LayoutGrid, showBadge: false },
  { href: '/groupbuy', label: '공구', Icon: Users, showBadge: false },
  { href: '/cart', label: '장바구니', Icon: ShoppingCart, showBadge: true },
  { href: '/mypage', label: 'MY', Icon: User, showBadge: false },
] as const;

const HIDDEN_PATHS = ['/checkout', '/order/success', '/products/'];

type StoreModeStatus = 'loading' | 'ready' | 'error';

interface StoreModeState {
  salesMode: SalesMode;
  status: StoreModeStatus;
}

function findSingleStoreId(products: Product[]) {
  const storeIds = new Set(
    products.map((product) => product.storeId).filter((storeId) => storeId.length > 0),
  );
  return storeIds.size === 1 ? [...storeIds][0] : null;
}

function useStoreMode(storeId: string | null, productsLoading: boolean): StoreModeState {
  const [state, setState] = useState<StoreModeState>({
    salesMode: 'legacy',
    status: 'loading',
  });

  useEffect(() => {
    if (productsLoading) {
      setState({ salesMode: 'legacy', status: 'loading' });
      return;
    }
    if (!storeId) {
      setState({ salesMode: 'legacy', status: 'ready' });
      return;
    }

    let active = true;
    setState({ salesMode: 'legacy', status: 'loading' });

    void getDoc(doc(db, 'stores', storeId))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) throw new Error('스토어를 찾을 수 없습니다.');

        const value = snapshot.data()?.salesMode;
        if (value !== undefined && value !== 'legacy' && value !== 'round_direct') {
          throw new Error('판매 방식 정보가 올바르지 않습니다.');
        }
        setState({ salesMode: normalizeSalesMode(value), status: 'ready' });
      })
      .catch(() => {
        if (active) setState({ salesMode: 'legacy', status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [productsLoading, storeId]);

  return state;
}

export default function BottomNav() {
  const pathname = usePathname();
  const { itemCount } = useCart();
  const { products, loading: productsLoading, error: productsError } = useProducts();
  const storeId = useMemo(() => findSingleStoreId(products), [products]);
  const storeMode = useStoreMode(storeId, productsLoading);

  if (HIDDEN_PATHS.some((path) => pathname.startsWith(path))) return null;
  if (productsError || storeMode.status !== 'ready') return null;

  const tabs = storeMode.salesMode === 'round_direct' ? ROUND_DIRECT_TABS : LEGACY_TABS;

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
          const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          const { Icon } = tab;

          return (
            <UnstyledButton key={tab.href} component={Link} href={tab.href} style={{ flex: 1 }}>
              <Stack
                align="center"
                justify="center"
                gap={2}
                h="100%"
                style={{ position: 'relative' }}
              >
                <Box style={{ position: 'relative', display: 'inline-flex' }}>
                  <Icon
                    size={24}
                    strokeWidth={isActive ? 2.2 : 1.8}
                    color={isActive ? 'var(--color-primary)' : 'var(--color-text-disabled)'}
                  />
                  {tab.showBadge && itemCount > 0 && (
                    <Box
                      style={{
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
                      }}
                    >
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
          );
        })}
      </Box>
    </Box>
  );
}
