import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./cartValidation.ts', import.meta.url), 'utf8');
const testableSource = `${source}
export { getCartItemValidationIssues, getCartValidationError, hasCartValidationIssues };`;
const compiled = ts.transpileModule(testableSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'cartValidation.ts',
}).outputText;

const validationModule = { exports: {} };
const requireForTest = (specifier) => {
  if (specifier === '@/hooks/useCart') {
    return {
      isRoundCartItem: (item) =>
        typeof item?.storeId === 'string' &&
        item.storeId.length > 0 &&
        typeof item?.roundId === 'string' &&
        typeof item?.roundItemId === 'string' &&
        item.roundPrice === item.price,
    };
  }
  throw new Error(`예상하지 못한 장바구니 검증 모듈 요청: ${specifier}`);
};

new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  validationModule,
  validationModule.exports,
);

const { getCartItemValidationIssues, getCartValidationError, hasCartValidationIssues } =
  validationModule.exports;

const legacyItem = {
  productId: 'product-1',
  name: '기존 호접란',
  price: 25000,
  image: '',
  quantity: 1,
  saleType: 'normal',
  deliveryMethod: 'direct',
  storeId: 'store-1',
  requestedDeliveryDate: '2026-09-08',
};

test('스토어가 없는 legacy 항목은 결제 전에 차단한다', () => {
  const issues = getCartItemValidationIssues({ ...legacyItem, storeId: '' });

  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['missing-store'],
  );
  assert.equal(hasCartValidationIssues([{ ...legacyItem, storeId: '' }]), true);
  assert.match(getCartValidationError([{ ...legacyItem, storeId: '' }]), /상점 정보/);
});

test('배송 희망일이 없는 배송 대상 legacy 항목은 결제 전에 차단한다', () => {
  const item = { ...legacyItem, requestedDeliveryDate: undefined };

  assert.deepEqual(
    getCartItemValidationIssues(item).map((issue) => issue.code),
    ['missing-delivery-date'],
  );
  assert.match(getCartValidationError([item]), /배송 날짜/);
});

test('필수 정보가 있는 legacy 장바구니는 기존 결제를 허용한다', () => {
  assert.deepEqual(getCartItemValidationIssues(legacyItem), []);
  assert.equal(getCartValidationError([legacyItem]), null);
  assert.equal(hasCartValidationIssues([legacyItem]), false);
});

test('택배·공동구매와 회차 직배송은 legacy 배송일 가드의 대상이 아니다', () => {
  assert.deepEqual(
    getCartItemValidationIssues({
      ...legacyItem,
      deliveryMethod: 'parcel',
      requestedDeliveryDate: undefined,
    }),
    [],
  );
  assert.deepEqual(
    getCartItemValidationIssues({
      ...legacyItem,
      saleType: 'group',
      requestedDeliveryDate: undefined,
    }),
    [],
  );
  assert.deepEqual(
    getCartItemValidationIssues({
      ...legacyItem,
      requestedDeliveryDate: undefined,
      roundId: 'round-1',
      roundItemId: 'round-item-1',
      roundPrice: legacyItem.price,
    }),
    [],
  );
});
