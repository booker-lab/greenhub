import { describe, expect, it } from 'vitest';
import { isAdminPath, isPureAdmin, postLoginPath } from './admin-landing';

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
});
