// 관리자 메뉴 항목과 현재 탭 판정 — 순수 함수(vitest에서 '@/' alias 없이 검증한다).

export interface AdminNavItem {
  href: string;
  label: string;
}

/** 기능 토글이 꺼진 메뉴는 숨긴다. 토글 값은 서버 레이아웃이 읽어 넘긴다. */
export function buildAdminNavItems(features: {
  partnerInquiry: boolean;
  reviews: boolean;
}): AdminNavItem[] {
  return [
    { href: '/admin/stores', label: '판매자' },
    { href: '/admin/users', label: '소비자' },
    { href: '/admin/drivers', label: '드라이버' },
    { href: '/admin/orders', label: '주문' },
    { href: '/admin/settlements', label: '정산' },
    { href: '/admin/invite', label: '초대' },
    { href: '/admin/banner', label: '배너' },
    ...(features.partnerInquiry ? [{ href: '/admin/partner-inquiries', label: '입점 문의' }] : []),
    ...(features.reviews ? [{ href: '/admin/reviews', label: '후기' }] : []),
    { href: '/admin/audit', label: '기록' },
  ];
}

/** 현재 주소가 그 메뉴이거나 그 아래 화면이면 현재 탭이다(`/admin/orders`와 `/admin/ordersx`는 구분). */
export function isAdminNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
