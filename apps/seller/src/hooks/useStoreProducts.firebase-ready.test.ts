import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./useStoreProducts.ts', import.meta.url), 'utf8');

describe('Seller 상품 구독은 Firebase 로그인 뒤에 시작한다', () => {
  it('Firebase 로그인 상태를 읽고, 로그인 전에는 onSnapshot을 만들지 않는다', () => {
    expect(source).toMatch(/const firebaseReady = useFirebaseReady\(\);/);
    const guard = source.indexOf('if (!firebaseReady) return;');
    const subscribe = source.indexOf('onSnapshot(');
    expect(guard).toBeGreaterThan(-1);
    expect(subscribe).toBeGreaterThan(guard);
  });

  it('Firebase 로그인이 끝나면 다시 구독하도록 effect 의존성에 포함한다', () => {
    expect(source).toMatch(/\}, \[scope, retryKey, firebaseReady\]\);/);
  });

  it('로그인 전 대기는 오류나 빈 목록으로 바꾸지 않는다', () => {
    const guardLine = source.split('\n').find((line) => line.includes('if (!firebaseReady)'));
    expect(guardLine?.trim()).toBe('if (!firebaseReady) return;');
  });
});
