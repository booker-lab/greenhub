import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const formSource = await readFile(new URL('./CheckoutForm.tsx', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(formSource, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'CheckoutForm.tsx',
}).outputText;

const formModule = { exports: {} };
const requireForTest = (specifier) => {
  if (specifier === 'react') {
    return {
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
      useState: (initial) => [initial, () => {}],
    };
  }
  if (specifier === 'react/jsx-runtime') {
    return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
  }
  if (specifier === '@/hooks/useCart') {
    return {
      isRoundCartItem: (item) =>
        typeof item?.roundId === 'string' &&
        typeof item?.roundItemId === 'string' &&
        item.roundPrice === item.price,
    };
  }
  if (specifier === '@mantine/core') return {};
  throw new Error(`예상하지 못한 결제 폼 모듈 요청: ${specifier}`);
};
new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  formModule,
  formModule.exports,
);

test('회차 배송 주소는 주소 선두의 이천시 행정구역 경계로 판정한다', () => {
  const { isIcheonDeliveryAddress } = formModule.exports;

  assert.equal(isIcheonDeliveryAddress('경기도 이천시 중리천로 1'), true);
  assert.equal(isIcheonDeliveryAddress('경기 이천시 창전동 1'), true);
  assert.equal(isIcheonDeliveryAddress('이천시 부발읍 1'), true);
  assert.equal(isIcheonDeliveryAddress('서울특별시 강남구 이천시로 1'), false);
  assert.equal(isIcheonDeliveryAddress('경기도 이천시청로 1'), false);
});

test('회차 폼은 배송 연락처와 이천시 배송 가능 주소를 명확히 구분한다', () => {
  assert.match(formSource, /배송 연락처/);
  assert.match(formSource, /이천시 배송 가능 주소/);
  assert.match(formSource, /주문·결제·배송 안내를 위한 정보성 연락/);
  assert.match(formSource, /isIcheonDeliveryAddress\(address\.address\)/);
});

test('회차 폼은 기상 연기와 청약철회 제한 및 계약 불이행 예외를 필수 고지한다', () => {
  assert.match(formSource, /필수 고지/);
  assert.match(formSource, /경기도 이천시 직접배송/);
  assert.match(formSource, /재배송비\s+없이 새 배송 일정/);
  assert.match(formSource, /상품\s+가치가\s+현저히\s+감소/);
  assert.match(formSource, /표시·광고 또는 계약\s+내용과 다르게 이행된 경우/);
});

test('선택 마케팅 동의는 기본 해제 상태이며 배송 연락처와 별도 주문 값으로 전달한다', () => {
  assert.match(formSource, /마케팅 정보 수신 동의\(선택\)/);
  assert.match(formSource, /checked=\{marketingConsent\}/);
  assert.match(formSource, /onMarketingConsentChange/);
  assert.match(pageSource, /useState<string \| null>\(null\)/);
  assert.match(pageSource, /marketingConsent:\s*\{/);
  assert.match(pageSource, /channels: \['alimtalk', 'sms'\]/);
  assert.match(pageSource, /agreedAt: marketingAgreedAt/);
});

test('회차 결제는 상품·가격·회차 변경 확인 전 차단하고 요약 변경 시 확인을 초기화한다', () => {
  assert.match(formSource, /상품 정보가 변경/);
  assert.match(formSource, /변경 내용을 확인/);
  assert.match(formSource, /setRoundDetailsConfirmed\(false\)/);
  assert.match(formSource, /confirmationKey/);
  assert.match(pageSource, /상품·가격·회차 정보가 변경되어 결제할 수 없습니다/);
  assert.match(formSource, /effectiveCanPay\s*=\s*canPay\s*&&\s*\(!isRoundCheckout\s*\|\|/);
  assert.match(formSource, /disabled=\{!effectiveCanPay\}/);
});

test('Task 4.14 단일 회차 주문·결제와 완료 후 checkout_cart 삭제 계약을 보존한다', () => {
  const start = pageSource.indexOf('function RoundCartCheckoutContent');
  const end = pageSource.indexOf('function CartCheckoutContent', start);
  const roundCheckoutSource = pageSource.slice(start, end);

  assert.match(roundCheckoutSource, /usePayment\(\{/);
  assert.match(roundCheckoutSource, /roundItems: cartItems/);
  assert.doesNotMatch(roundCheckoutSource, /for \(const item of cartItems\)/);
  assert.match(roundCheckoutSource, /state !== 'done' \|\| !orderId/);
  assert.match(roundCheckoutSource, /removeItem\('checkout_cart'\)/);
  assert.ok(
    roundCheckoutSource.indexOf("state !== 'done' || !orderId") <
      roundCheckoutSource.indexOf("removeItem('checkout_cart')"),
  );
});
