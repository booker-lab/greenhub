import { describe, expect, it } from 'vitest';
import { isAdminPath } from './AppShell';

describe('앱 셸 폭', () => {
  it.each([
    '/admin',
    '/admin/',
    '/admin/orders',
    '/admin/stores/abc',
  ])('%s 는 어드민 콘솔이라 폭 제한을 풀고 판매자 하단 탭을 숨긴다', (pathname) => {
    expect(isAdminPath(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/orders',
    '/sale-rounds/round-a',
    '/administrator',
    '/settings/admin',
  ])('%s 는 판매자 화면이라 모바일 폭을 유지한다', (pathname) => {
    expect(isAdminPath(pathname)).toBe(false);
  });
});
