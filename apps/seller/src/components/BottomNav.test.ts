import { describe, expect, it } from 'vitest';
import { isBottomNavHidden, isBottomNavItemActive, SELLER_BOTTOM_NAV_ITEMS } from './BottomNav';

describe('셀러 하단 메뉴', () => {
  it('주문·회차·상품·준비·설정 순서와 경로를 고정한다', () => {
    expect(SELLER_BOTTOM_NAV_ITEMS.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/orders', label: '주문' },
      { href: '/sale-rounds', label: '회차' },
      { href: '/products', label: '상품' },
      { href: '/prep', label: '준비' },
      { href: '/settings', label: '설정' },
    ]);
  });

  it.each(['/sale-rounds', '/sale-rounds/round-a'])(
    '%s 경로에서는 회차 메뉴만 활성화한다',
    (pathname) => {
      const activeItems = SELLER_BOTTOM_NAV_ITEMS.filter(({ href }) =>
        isBottomNavItemActive(pathname, href),
      );

      expect(activeItems.map(({ label }) => label)).toEqual(['회차']);
    },
  );

  it('비슷한 접두사 경로를 메뉴 활성 상태로 잘못 판정하지 않는다', () => {
    expect(isBottomNavItemActive('/sale-rounds-archive', '/sale-rounds')).toBe(false);
    expect(isBottomNavItemActive('/orders-preview', '/orders')).toBe(false);
  });

  it.each(['/settings', '/settings/payout-account', '/settlements', '/hubs', '/hubs/hub-a'])(
    '%s 경로에서는 설정 메뉴만 활성화한다',
    (pathname) => {
      const activeItems = SELLER_BOTTOM_NAV_ITEMS.filter(({ href }) =>
        isBottomNavItemActive(pathname, href),
      );

      expect(activeItems.map(({ label }) => label)).toEqual(['설정']);
    },
  );

  it('홈에서 들어가는 운영 확인은 어떤 메뉴도 활성화하지 않는다', () => {
    expect(
      SELLER_BOTTOM_NAV_ITEMS.filter(({ href }) => isBottomNavItemActive('/operations', href)),
    ).toEqual([]);
    expect(isBottomNavItemActive('/hubs-archive', '/settings')).toBe(false);
  });

  it.each(['/login', '/onboarding', '/invite/token-a', '/admin'])(
    '%s 경로에서는 하단 메뉴를 숨긴다',
    (pathname) => {
      expect(isBottomNavHidden(pathname)).toBe(true);
    },
  );

  it.each(['/', '/orders', '/settings'])('%s 경로에서는 하단 메뉴를 보인다', (pathname) => {
    expect(isBottomNavHidden(pathname)).toBe(false);
  });
});
