import { describe, expect, it } from 'vitest';
import { canGoBackInApp } from './inAppNavigation';

describe('canGoBackInApp', () => {
  it('바로 앞 기록이 같은 출처 항목이면(Navigation API canGoBack) 뒤로 간다', () => {
    expect(canGoBackInApp({ canGoBack: true })).toBe(true);
  });

  it('주소로 바로 들어왔거나 앞이 외부 사이트면(canGoBack false) 뒤로 가지 않는다', () => {
    // 외부 → /hubs → /hubs/[id] → 뒤로 와서 /hubs에 있으면 지금 항목이 첫 같은 출처 항목이라 false다.
    expect(canGoBackInApp({ canGoBack: false })).toBe(false);
  });

  it('Navigation API가 없거나 값이 이상하면 앱 밖으로 나가지 않도록 false다', () => {
    expect(canGoBackInApp(undefined)).toBe(false);
    expect(canGoBackInApp({})).toBe(false);
    expect(canGoBackInApp({ canGoBack: 'true' })).toBe(false);
  });

  it('인자를 주지 않으면 전역 navigation을 읽는다(테스트 환경에는 없어 false)', () => {
    expect(canGoBackInApp()).toBe(false);
  });
});
