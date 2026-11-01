import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAdminNavGroups, formatAdminTodoCount, isAdminNavActive } from './navItems';
import { ADMIN_TODO_PATHS, readAdminTodoCount } from './todoCounts';

const navSource = readFileSync(new URL('./AdminNav.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('./AdminShell.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../layout.tsx', import.meta.url), 'utf8');

const labelsOf = (features: { partnerInquiry: boolean; reviews: boolean }) =>
  buildAdminNavGroups(features).map((g) => [g.label, g.items.map((i) => i.label)]);

describe('관리자 메뉴 현재 메뉴 판정', () => {
  it('그 메뉴와 그 아래 화면을 현재 메뉴로 본다', () => {
    expect(isAdminNavActive('/admin/orders', '/admin/orders')).toBe(true);
    expect(isAdminNavActive('/admin/orders/abc', '/admin/orders')).toBe(true);
  });

  it('이름이 앞부분만 같은 다른 주소·다른 메뉴·주소 없음은 현재 메뉴가 아니다', () => {
    expect(isAdminNavActive('/admin/ordersx', '/admin/orders')).toBe(false);
    expect(isAdminNavActive('/admin/stores', '/admin/orders')).toBe(false);
    expect(isAdminNavActive(null, '/admin/orders')).toBe(false);
  });
});

describe('관리자 메뉴 묶음', () => {
  it('할 일 순서로 묶고, 기능 토글이 꺼진 입점 문의·후기는 숨긴다', () => {
    expect(labelsOf({ partnerInquiry: false, reviews: false })).toEqual([
      ['오늘 할 일', ['주문', '정산', '기사']],
      ['사람과 가게', ['판매자', '소비자', '초대']],
      ['기록과 설정', ['배너', '감사 기록']],
    ]);
  });

  it('입점 문의는 사람과 가게 끝에, 후기는 감사 기록 앞에 보인다(2026-11-01 사용자 결정)', () => {
    expect(labelsOf({ partnerInquiry: true, reviews: true })).toEqual([
      ['오늘 할 일', ['주문', '정산', '기사']],
      ['사람과 가게', ['판매자', '소비자', '초대', '입점 문의']],
      ['기록과 설정', ['배너', '후기', '감사 기록']],
    ]);
  });

  it('할 일 수는 주문·정산·기사에만 붙는다', () => {
    const todo = buildAdminNavGroups({ partnerInquiry: true, reviews: true })
      .flatMap((g) => g.items)
      .filter((i) => i.todo)
      .map((i) => [i.label, i.todo]);
    expect(todo).toEqual([
      ['주문', 'orders'],
      ['정산', 'settlements'],
      ['기사', 'drivers'],
    ]);
  });

  it('메뉴는 next/link로 이동하고 현재 메뉴에 aria-current="page"를 단다', () => {
    expect(navSource).toContain("import Link from 'next/link'");
    expect(navSource).toContain('usePathname()');
    expect(navSource).toContain("aria-current={active ? 'page' : undefined}");
    expect(navSource).not.toMatch(/<a\s/);
  });

  it('레이아웃이 기능 토글 값을 메뉴 묶음에 넘기고 틀을 그린다', () => {
    expect(layoutSource).toContain("partnerInquiry: isFeatureOn('partner-inquiry')");
    expect(layoutSource).toContain("reviews: isFeatureOn('reviews')");
    expect(layoutSource).toContain('<AdminShell');
    expect(shellSource).toContain('<AdminNav');
  });
});

describe('할 일 수', () => {
  it('단위는 "건"이고, 0이거나 모르면 쓰지 않는다', () => {
    expect(formatAdminTodoCount({ count: 3, more: false })).toBe('3건');
    expect(formatAdminTodoCount({ count: 100, more: true })).toBe('100건+');
    expect(formatAdminTodoCount({ count: 0, more: false })).toBeNull();
    expect(formatAdminTodoCount(null)).toBeNull();
    expect(formatAdminTodoCount(undefined)).toBeNull();
  });

  it('기존 관리자 조회 세 개로 센다', () => {
    expect(ADMIN_TODO_PATHS).toEqual({
      orders: '/admin/orders?status=DELIVERY_HELD&limit=100',
      settlements: '/admin/settlements/summary',
      drivers: '/admin/drivers?status=pending&limit=200',
    });
  });

  it('목록 응답은 받은 건수와 hasMore를, 정산 합계는 payable.count와 truncated를 읽는다', () => {
    expect(readAdminTodoCount('orders', { orders: [{}, {}], hasMore: false })).toEqual({
      count: 2,
      more: false,
    });
    expect(readAdminTodoCount('drivers', { drivers: [{}], hasMore: true })).toEqual({
      count: 1,
      more: true,
    });
    expect(
      readAdminTodoCount('settlements', { payable: { count: 3, netAmount: 1 }, truncated: false }),
    ).toEqual({ count: 3, more: false });
  });

  it('응답 모양이 다르면 숫자를 쓰지 않는다', () => {
    expect(readAdminTodoCount('orders', { items: [] })).toBeNull();
    expect(readAdminTodoCount('drivers', null)).toBeNull();
    expect(readAdminTodoCount('settlements', { payable: {} })).toBeNull();
  });
});
