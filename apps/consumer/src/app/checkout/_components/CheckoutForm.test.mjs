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

const optionsSource = await readFile(
  new URL('../../../lib/payment-method-options.ts', import.meta.url),
  'utf8',
);
const compiledOptions = ts.transpileModule(optionsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'payment-method-options.ts',
}).outputText;

/** 채널 키 환경변수를 바꿔 가며 결제수단 선택지 모듈을 새로 평가한다. */
function loadPaymentMethodOptions(environment) {
  const keys = ['NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY', 'NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (environment[key] === undefined) delete process.env[key];
      else process.env[key] = environment[key];
    }
    const optionsModule = { exports: {} };
    new Function('module', 'exports', compiledOptions)(optionsModule, optionsModule.exports);
    return optionsModule.exports;
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const readinessSource = await readFile(
  new URL('../../../lib/payment-readiness.ts', import.meta.url),
  'utf8',
);
const readinessModule = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(readinessSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(readinessModule, readinessModule.exports);

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
  if (
    specifier === '@greenhub/ui/components/alert' ||
    specifier === '@greenhub/ui/components/button' ||
    specifier === '@greenhub/ui/components/checkbox' ||
    specifier === '@greenhub/ui/components/field' ||
    specifier === '@greenhub/ui/components/input' ||
    specifier === '@/components/LoadingButton' ||
    specifier === '@greenhub/ui/components/textarea'
  ) {
    return {};
  }
  if (specifier === '@greenhub/shared') return { ORDER_REQUEST_NOTE_MAX_LENGTH: 200 };
  // 벤치마킹 비교 기능(선물하기) 칸은 이 테스트에서 그리지 않는다.
  if (specifier === '@/components/benchmark/GiftFields') return { default: () => null };
  if (specifier === '@/components/benchmark/PackageLabelFields') return { default: () => null };
  if (specifier === '@/lib/payment-method-options') return loadPaymentMethodOptions({});
  if (specifier === '@/lib/payment-readiness') return readinessModule.exports;
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

test('파일럿 회차 결제는 선택 마케팅 동의 UI와 주문 값을 사용하지 않는다', () => {
  assert.doesNotMatch(formSource, /마케팅 정보 수신 동의/);
  assert.doesNotMatch(formSource, /marketingConsent|onMarketingConsentChange/);
  assert.doesNotMatch(pageSource, /marketingConsent|marketingAgreedAt/);
  assert.match(formSource, /배송 연락처/);
  assert.match(formSource, /주문·결제·배송 안내를 위한 정보성 연락/);
});

test('회차 결제는 상품·가격·회차 변경 확인 전 차단하고 요약 변경 시 확인을 초기화한다', () => {
  // 확인 체크는 늘 필수라 조건문 대신 필수임이 드러나는 문구를 쓴다(C-03).
  assert.match(formSource, /주문 상품·수량·회차 가격을 확인했어요\(필수\)/);
  assert.match(formSource, /체크해야 결제할 수 있어요/);
  assert.match(formSource, /상품\s+정보가 바뀌면 체크가 풀려요/);
  assert.doesNotMatch(formSource, /상품 정보가 변경되면/);
  assert.match(formSource, /setRoundDetailsConfirmed\(false\)/);
  assert.match(formSource, /confirmationKey/);
  assert.match(pageSource, /상품·가격·회차 정보가 바뀌어 결제할 수 없어요/);
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

test('연락처 형식 오류는 칸을 벗어난 뒤에만 보여 준다', () => {
  assert.match(formSource, /onBlur=\{\(\) => setDeliveryPhoneTouched\(true\)\}/);
  assert.match(
    formSource,
    /error=\{deliveryPhoneTouched && deliveryPhoneError \? deliveryPhoneError : undefined\}/,
  );
});

test('카드 채널 키가 없으면 카드 선택지를 숨기고, 있으면 카드 결제를 보여 준다', () => {
  const withoutCard = loadPaymentMethodOptions({});
  assert.deepEqual(
    withoutCard.PAYMENT_METHOD_OPTIONS.map((option) => option.method),
    ['kakaopay'],
  );

  const withCard = loadPaymentMethodOptions({
    NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY: 'card-channel',
  });
  assert.deepEqual(
    withCard.PAYMENT_METHOD_OPTIONS.map((option) => option.method),
    ['kakaopay', 'card'],
  );

  const withAll = loadPaymentMethodOptions({
    NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY: 'naver-channel',
    NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY: 'card-channel',
  });
  assert.deepEqual(
    withAll.PAYMENT_METHOD_OPTIONS.map((option) => option.method),
    ['kakaopay', 'naverpay', 'card'],
  );
});

test('결제 버튼 문구는 고른 결제수단을 따른다', () => {
  const { paymentButtonLabel } = loadPaymentMethodOptions({});
  assert.equal(paymentButtonLabel('kakaopay'), '카카오페이로 결제하기');
  assert.equal(paymentButtonLabel('naverpay'), '네이버페이로 결제하기');
  assert.equal(paymentButtonLabel('card'), '카드로 결제하기');
  assert.match(formSource, /PAYMENT_METHOD_OPTIONS\.map/);
  assert.match(formSource, /paymentButtonLabel\(paymentMethod\)/);
});

test('결제 폼은 이탈 확인창을 직접 걸지 않는다(결제 단계별 경고는 결제 훅이 맡는다)', () => {
  assert.doesNotMatch(formSource, /beforeunload/);
});

test('회차 결제 버튼이 꺼져 있으면 버튼 바로 위에 빠진 조건을 보인다', () => {
  assert.match(formSource, /roundPayBlockers\(\{/);
  assert.match(formSource, /detailsConfirmed: roundDetailsConfirmed/);
  assert.match(
    formSource,
    /isRoundCheckout && roundPayReadiness && !effectiveCanPay && !isLoading/,
  );
  assert.match(formSource, /결제하려면 아래 내용을 확인해 주세요\./);
  // 안내는 결제 버튼 바로 앞에 그리고 버튼이 안내를 가리킨다.
  const blockers = formSource.indexOf('{payBlockers.length > 0 && (');
  const button = formSource.indexOf('<LoadingButton');
  assert.ok(blockers >= 0 && blockers < button);
  assert.match(
    formSource,
    /aria-describedby=\{payBlockers\.length > 0 \? payBlockersId : undefined\}/,
  );
  assert.match(
    pageSource,
    /roundPayReadiness=\{\{ phoneValid: deliveryPhoneValid, giftReady, packageLabelReady \}\}/,
  );
});

test('회차 마감 안내는 결제 버튼 바로 위에 두고 빠진 조건 목록을 대신한다(C-13)', () => {
  assert.match(formSource, /closedNotice\?: ReactNode;/);
  assert.match(
    formSource,
    /!closedNotice && isRoundCheckout && roundPayReadiness && !effectiveCanPay && !isLoading/,
  );
  const blockers = formSource.indexOf('{payBlockers.length > 0 && (');
  const notice = formSource.indexOf('{closedNotice}');
  const button = formSource.indexOf('<LoadingButton');
  assert.ok(blockers >= 0 && blockers < notice && notice < button);
});
