import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAdminNavItems, isAdminNavActive } from './navItems';

const navSource = readFileSync(new URL('./AdminNav.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../layout.tsx', import.meta.url), 'utf8');

describe('관리자 메뉴 현재 탭 판정', () => {
  it('그 메뉴와 그 아래 화면을 현재 탭으로 본다', () => {
    expect(isAdminNavActive('/admin/orders', '/admin/orders')).toBe(true);
    expect(isAdminNavActive('/admin/orders/abc', '/admin/orders')).toBe(true);
  });

  it('이름이 앞부분만 같은 다른 주소·다른 메뉴·주소 없음은 현재 탭이 아니다', () => {
    expect(isAdminNavActive('/admin/ordersx', '/admin/orders')).toBe(false);
    expect(isAdminNavActive('/admin/stores', '/admin/orders')).toBe(false);
    expect(isAdminNavActive(null, '/admin/orders')).toBe(false);
  });
});

describe('관리자 메뉴 항목', () => {
  it('기능 토글이 꺼진 입점 문의·후기 메뉴는 숨긴다', () => {
    const labels = buildAdminNavItems({ partnerInquiry: false, reviews: false }).map((i) => i.label);
    expect(labels).toEqual(['판매자', '소비자', '드라이버', '주문', '정산', '초대', '배너', '기록']);
  });

  it('기능 토글이 켜지면 기록 앞에 보인다', () => {
    const labels = buildAdminNavItems({ partnerInquiry: true, reviews: true }).map((i) => i.label);
    expect(labels.slice(-3)).toEqual(['입점 문의', '후기', '기록']);
  });

  it('메뉴는 next/link로 이동하고 현재 탭에 aria-current="page"를 단다', () => {
    expect(navSource).toContain("import Link from 'next/link'");
    expect(navSource).toContain('usePathname()');
    expect(navSource).toContain("aria-current={active ? 'page' : undefined}");
    expect(navSource).not.toMatch(/<a\s/);
  });

  it('레이아웃이 기능 토글 값을 메뉴에 넘긴다', () => {
    expect(layoutSource).toContain("partnerInquiry: isFeatureOn('partner-inquiry')");
    expect(layoutSource).toContain("reviews: isFeatureOn('reviews')");
    expect(layoutSource).toContain('<AdminNav');
  });
});
