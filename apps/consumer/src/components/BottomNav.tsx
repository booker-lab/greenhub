'use client';

import type { Product, SalesMode } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import { Home, LayoutGrid, ShoppingCart, User, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { useCart } from '@/hooks/useCart';
import { useProducts } from '@/hooks/useProducts';
import { fetchPublicStoreProfile } from '@/lib/public-store-profile';
import { isFeatureOn } from '@/lib/features';

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

// ① 외형 유지(UI 교체 P5): Mantine UnstyledButton(component=Link, 초점 링 mantine-focus-auto)·Stack(가운데, gap 2,
// 높이 100%)·Text(p, 줄 높이 1.55)와 같은 값.
const TAB_LINK =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-[16px] text-inherit no-underline touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid';

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

    void fetchPublicStoreProfile(storeId)
      .then((profile) => {
        if (!active) return;
        const value = profile.salesMode;
        if (value !== 'legacy' && value !== 'round_direct') {
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

// 숨기는 경로(결제·주문 완료·상품 상세)에서는 상품 목록·매장 프로필 조회가 필요 없으므로
// 경로부터 판정하고, 보일 때만 조회하는 하위 컴포넌트를 마운트한다.
export default function BottomNav() {
  const pathname = usePathname();
  if (HIDDEN_PATHS.some((path) => pathname.startsWith(path))) return null;
  return <VisibleBottomNav pathname={pathname} />;
}

function VisibleBottomNav({ pathname }: { pathname: string }) {
  const { status: sessionStatus } = useSession();
  const { itemCount } = useCart();
  // 비회원 장바구니(guest-cart, 벤치마킹 비교 기능)가 켜지면 로그인 전에도 담은 수를 보여준다.
  const visibleItemCount =
    sessionStatus === 'authenticated' || (isFeatureOn('guest-cart') && sessionStatus !== 'loading')
      ? itemCount
      : 0;
  const { products, loading: productsLoading, error: productsError } = useProducts();
  const storeId = useMemo(() => findSingleStoreId(products), [products]);
  const storeMode = useStoreMode(storeId, productsLoading);

  if (productsError || storeMode.status !== 'ready') return null;

  const tabs = storeMode.salesMode === 'round_direct' ? ROUND_DIRECT_TABS : LEGACY_TABS;

  return (
    <nav
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
      <div style={{ display: 'flex', maxWidth: 430, margin: '0 auto', height: '100%' }}>
        {tabs.map((tab) => {
          const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          const { Icon } = tab;

          return (
            <Link key={tab.href} href={tab.href} className={TAB_LINK} style={{ flex: 1 }}>
              <div
                className="flex h-full flex-col items-center justify-center gap-0.5"
                style={{ position: 'relative' }}
              >
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  <Icon
                    size={24}
                    strokeWidth={isActive ? 2.2 : 1.8}
                    color={isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)'}
                  />
                  {tab.showBadge && visibleItemCount > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -10,
                        background: 'var(--color-primary-dark)',
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
                      {visibleItemCount > 99 ? '99+' : visibleItemCount}
                    </div>
                  )}
                </div>
                <p
                  className="m-0 p-0 leading-[1.55]"
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: isActive ? 'var(--fw-extrabold)' : 'var(--fw-medium)',
                    color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-secondary)',
                  }}
                >
                  {tab.label}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
