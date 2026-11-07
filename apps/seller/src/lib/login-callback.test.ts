import { describe, expect, it } from 'vitest';
import { safeCallbackPath } from './login-callback';

describe('로그인 뒤 돌아갈 경로(callbackUrl) 검증', () => {
  it('같은 출처 상대 경로는 경로·쿼리·해시를 그대로 받는다', () => {
    expect(safeCallbackPath('/orders')).toBe('/orders');
    expect(safeCallbackPath('/orders/abc')).toBe('/orders/abc');
    expect(safeCallbackPath('/orders?status=paid&page=2')).toBe('/orders?status=paid&page=2');
    expect(safeCallbackPath('/admin/stores#top')).toBe('/admin/stores#top');
    expect(safeCallbackPath('/')).toBe('/');
    expect(safeCallbackPath('/loginx')).toBe('/loginx');
    expect(safeCallbackPath('/apis')).toBe('/apis');
  });

  it('다른 사이트로 보내는 값은 거른다', () => {
    for (const value of [
      '//evil.example',
      '//evil.example/orders',
      '/\\evil.example',
      '/\\/evil.example',
      '\\\\evil.example',
      'https://evil.example',
      'http:/evil.example',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'orders',
      ' /orders',
      '/%2F%2Fevil.example',
      '/%5Cevil.example',
    ]) {
      expect(safeCallbackPath(value), value).toBeNull();
    }
  });

  it('제어문자가 들어간 값은 거른다', () => {
    for (const value of [
      '/\t/evil.example',
      '/\n/evil.example',
      '/orders\r\n',
      '/orders\u0000',
      '/\u007f',
    ]) {
      expect(safeCallbackPath(value), JSON.stringify(value)).toBeNull();
    }
    expect(safeCallbackPath('/%0A%0Devil')).toBeNull();
  });

  it('로그인·API 경로 자체는 거른다(정규화·인코딩으로 감춘 값 포함)', () => {
    for (const value of [
      '/login',
      '/login?callbackUrl=/orders',
      '/login/error',
      '/LOGIN',
      '/api',
      '/api/auth/signout',
      '/orders/../login',
      '/./api/auth/session',
      '/%6Cogin',
      '/%61pi/auth/session',
    ]) {
      expect(safeCallbackPath(value), value).toBeNull();
    }
  });

  it('문자열이 아니거나 비었거나 지나치게 길면 거른다', () => {
    expect(safeCallbackPath(undefined)).toBeNull();
    expect(safeCallbackPath(null)).toBeNull();
    expect(safeCallbackPath(['/orders'])).toBeNull();
    expect(safeCallbackPath('')).toBeNull();
    expect(safeCallbackPath(`/${'a'.repeat(2048)}`)).toBeNull();
    expect(safeCallbackPath('/%E0%A4%A')).toBeNull();
  });
});
