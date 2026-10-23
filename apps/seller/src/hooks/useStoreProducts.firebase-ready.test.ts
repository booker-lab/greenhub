import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./useStoreProducts.ts', import.meta.url), 'utf8');

// 로그인 전 구독자가 Firestore 구독을 열지 않는 동작은 useStoreProducts.hub.test.ts가 확인한다.
describe('Seller 상품 구독은 Firebase 로그인 뒤에 시작한다', () => {
  it('Firebase 로그인 상태를 읽어 로그인됐을 때만 공유 구독을 붙잡는다', () => {
    expect(source).toMatch(/const firebaseReady = useFirebaseReady\(\);/);
    expect(source).toMatch(/storeProductsHub\.subscribe\(storeId, onChange, firebaseReady\)/);
  });

  it('Firebase 로그인이 끝나면 다시 구독하도록 구독 함수 의존성에 포함한다', () => {
    expect(source).toMatch(/\[storeId, firebaseReady\],\n {2}\);/);
  });
});
