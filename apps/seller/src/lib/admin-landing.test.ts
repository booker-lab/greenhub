import { describe, expect, it } from 'vitest';
import { isAdminPath, isPureAdmin, kakaoCallbackUrl, postLoginPath } from './admin-landing';

describe('순수 관리자 판정과 로그인 뒤 경로', () => {
  it('가게 없는 관리자만 순수 관리자다', () => {
    expect(isPureAdmin({ role: 'admin' })).toBe(true);
    expect(isPureAdmin({ role: 'admin', storeId: null })).toBe(true);
    expect(isPureAdmin({ role: 'admin', storeId: 'store-1' })).toBe(false);
    expect(isPureAdmin({ role: 'seller' })).toBe(false);
    expect(isPureAdmin(null)).toBe(false);
  });

  it('순수 관리자는 관리자 콘솔로, 겸직·판매자는 주문 화면으로', () => {
    expect(postLoginPath({ role: 'admin' })).toBe('/admin/stores');
    expect(postLoginPath({ role: 'admin', storeId: 'store-1' })).toBe('/orders');
    expect(postLoginPath({ role: 'seller', storeId: 'store-1' })).toBe('/orders');
    expect(postLoginPath(undefined)).toBe('/orders');
  });

  it('/admin과 그 아래만 관리자 경로다', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/stores')).toBe(true);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isAdminPath('/orders')).toBe(false);
  });

  it('돌아갈 경로가 있으면 역할에 맞을 때만 쓴다', () => {
    const seller = { role: 'seller', storeId: 'store-1' };
    const pureAdmin = { role: 'admin' };
    const dual = { role: 'admin', storeId: 'store-1' };

    expect(postLoginPath(seller, '/orders/abc?tab=memo')).toBe('/orders/abc?tab=memo');
    // 판매자가 관리자 경로를 돌아갈 곳으로 가져도 판매자 홈으로 간다.
    expect(postLoginPath(seller, '/admin/stores')).toBe('/orders');
    expect(postLoginPath(seller, '/admin')).toBe('/orders');
    expect(postLoginPath({ role: 'seller' }, '/admin/stores')).toBe('/orders');
    expect(postLoginPath(undefined, '/admin/stores')).toBe('/orders');

    // 순수 관리자는 관리자 경로만 받고 그 밖에는 관리자 콘솔로 간다.
    expect(postLoginPath(pureAdmin, '/admin/partner-inquiries?page=2')).toBe(
      '/admin/partner-inquiries?page=2',
    );
    expect(postLoginPath(pureAdmin, '/orders/abc')).toBe('/admin/stores');

    // 겸직 계정은 판매자·관리자 경로 모두 그대로 쓴다.
    expect(postLoginPath(dual, '/orders/abc')).toBe('/orders/abc');
    expect(postLoginPath(dual, '/admin/stores')).toBe('/admin/stores');

    // 검증을 통과하지 못한 값은 버리고 기본 경로로 간다.
    for (const bad of ['//evil.example', 'https://evil.example', '/login', '/api/auth/signout']) {
      expect(postLoginPath(seller, bad)).toBe('/orders');
      expect(postLoginPath(pureAdmin, bad)).toBe('/admin/stores');
    }
    expect(postLoginPath(seller, null)).toBe('/orders');
  });

  it('카카오 로그인은 돌아갈 경로가 있으면 로그인 화면을 거쳐 역할을 확인한다', () => {
    expect(kakaoCallbackUrl('/orders/abc?tab=memo')).toBe(
      '/login?callbackUrl=%2Forders%2Fabc%3Ftab%3Dmemo',
    );
    expect(kakaoCallbackUrl('/admin/stores')).toBe('/login?callbackUrl=%2Fadmin%2Fstores');
    expect(kakaoCallbackUrl(null)).toBe('/orders');
    expect(kakaoCallbackUrl('//evil.example')).toBe('/orders');
    expect(kakaoCallbackUrl('/login')).toBe('/orders');
  });
});
