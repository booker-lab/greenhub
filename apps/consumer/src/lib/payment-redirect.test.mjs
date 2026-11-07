import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./payment-redirect.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const {
  ORDER_PAYMENT_REDIRECT_PATH,
  PENDING_ORDER_PAYMENT_STORAGE_KEY,
  DEFAULT_PAYMENT_FAILURE_MESSAGE,
  buildPaymentRedirectUrl,
  clearOwnPendingOrderPayment,
  createPendingOrderPayment,
  isOwnPendingOrderPayment,
  parsePaymentRedirectResult,
  readPendingOrderPayment,
  redeliveryPaymentRedirectPath,
  resolveOrderPaymentReturn,
  resolveRedeliveryPaymentReturn,
  savePendingOrderPayment,
  shouldRecheckRedeliveryPayment,
  takePendingOrderPayment,
} = module.exports;

const query = (search) => new URLSearchParams(search);
const NOW = 1_800_000_000_000;

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('PortOne 복귀 쿼리: paymentId만 있으면 성공, code가 있으면 메시지와 함께 실패로 해석한다', () => {
  assert.deepEqual(parsePaymentRedirectResult(query('')), { kind: 'none' });
  assert.deepEqual(parsePaymentRedirectResult(query('orderId=order-1')), { kind: 'none' });
  assert.deepEqual(parsePaymentRedirectResult(query('paymentId=order-1')), {
    kind: 'success',
    paymentId: 'order-1',
  });
  assert.deepEqual(
    parsePaymentRedirectResult(query('paymentId=order-1&transactionType=PAYMENT&txId=tx-1')),
    { kind: 'success', paymentId: 'order-1' },
  );
  assert.deepEqual(
    parsePaymentRedirectResult(
      query(
        `paymentId=order-1&code=FAILURE_TYPE_PG&message=${encodeURIComponent('사용자가 결제를 취소했습니다.')}&pgCode=USER_CANCEL&pgMessage=x`,
      ),
    ),
    {
      kind: 'failure',
      paymentId: 'order-1',
      code: 'FAILURE_TYPE_PG',
      message: '사용자가 결제를 취소했습니다.',
    },
  );
});

test('code 값이 비어도 성공으로 오인하지 않고, paymentId 없는 실패도 실패로 본다', () => {
  assert.deepEqual(parsePaymentRedirectResult(query('paymentId=order-1&code=')), {
    kind: 'failure',
    paymentId: 'order-1',
    code: 'UNKNOWN',
    message: null,
  });
  assert.deepEqual(parsePaymentRedirectResult(query('code=FAILURE_TYPE_PG')), {
    kind: 'failure',
    paymentId: null,
    code: 'FAILURE_TYPE_PG',
    message: null,
  });
});

test('중복·손상·다른 거래 유형 쿼리는 invalid로 거부한다', () => {
  for (const search of [
    'paymentId=a&paymentId=b',
    'paymentId=a&code=X&code=Y',
    'paymentId=a&transactionType=ISSUE_BILLING_KEY',
    `paymentId=${encodeURIComponent('../order')}`,
    `paymentId=${encodeURIComponent(' order-1')}`,
    `paymentId=${'a'.repeat(129)}`,
    'paymentId=',
  ]) {
    assert.deepEqual(parsePaymentRedirectResult(query(search)), { kind: 'invalid' }, search);
  }
});

test('실패 메시지의 제어 문자는 지우고 길이는 제한한다', () => {
  const result = parsePaymentRedirectResult(
    query(`code=X&message=${encodeURIComponent(`줄\n바꿈${'가'.repeat(300)}`)}`),
  );
  assert.equal(result.kind, 'failure');
  assert.equal(result.message.includes('\n'), false);
  assert.ok(result.message.length <= 201);
});

test('복귀 URL은 현재 origin 기준 절대 URL이고 외부·비 http(s) 경로는 만들지 않는다', () => {
  assert.equal(
    buildPaymentRedirectUrl('https://greenlove.example', ORDER_PAYMENT_REDIRECT_PATH),
    'https://greenlove.example/order/success',
  );
  assert.equal(
    buildPaymentRedirectUrl('http://localhost:3000', redeliveryPaymentRedirectPath('order-1')),
    'http://localhost:3000/mypage/orders/order-1',
  );
  assert.equal(redeliveryPaymentRedirectPath('a b'), '/mypage/orders/a%20b');
  assert.equal(buildPaymentRedirectUrl('https://greenlove.example', '//evil.example/x'), null);
  assert.equal(buildPaymentRedirectUrl('https://greenlove.example', 'order/success'), null);
  assert.equal(buildPaymentRedirectUrl('https://greenlove.example', '/\\evil.example'), null);
  assert.equal(buildPaymentRedirectUrl('null', '/order/success'), null);
  assert.equal(buildPaymentRedirectUrl('file:///C:/', '/order/success'), null);
});

test('결제 전 기록은 결제 시도 ID를 담지 않고, 체크아웃 경로만 재시도 경로로 허용한다', () => {
  const pending = createPendingOrderPayment({
    paymentId: 'order-1',
    roundItemIds: ['round-item-1', 'round-item-2'],
    clearCheckoutCart: true,
    retryPath: '/checkout?from=cart',
    now: NOW,
  });
  assert.deepEqual(pending, {
    version: 1,
    paymentId: 'order-1',
    roundItemIds: ['round-item-1', 'round-item-2'],
    clearCheckoutCart: true,
    unpaidItemCount: 0,
    retryPath: '/checkout?from=cart',
    createdAt: NOW,
  });
  assert.equal(Object.hasOwn(pending, 'clientOrderRequestId'), false);
  assert.deepEqual(readPendingOrderPayment(JSON.stringify(pending), NOW + 1000), pending);

  for (const retryPath of ['https://evil.example/checkout', '//evil.example', '/mypage', null]) {
    assert.equal(
      createPendingOrderPayment({
        paymentId: 'order-1',
        clearCheckoutCart: false,
        retryPath,
        now: NOW,
      }).retryPath,
      null,
    );
  }
  assert.equal(
    createPendingOrderPayment({
      paymentId: '',
      clearCheckoutCart: false,
      retryPath: null,
      now: NOW,
    }),
    null,
  );
});

test('오래됐거나 손상된 결제 전 기록은 쓰지 않는다', () => {
  const pending = createPendingOrderPayment({
    paymentId: 'order-1',
    clearCheckoutCart: true,
    retryPath: '/checkout?from=cart',
    now: NOW,
  });
  assert.equal(readPendingOrderPayment(JSON.stringify(pending), NOW + 3 * 60 * 60 * 1000), null);
  assert.equal(readPendingOrderPayment(JSON.stringify(pending), NOW - 1), null);
  assert.equal(readPendingOrderPayment('{깨짐', NOW), null);
  assert.equal(readPendingOrderPayment(JSON.stringify({ ...pending, version: 2 }), NOW), null);
  assert.equal(
    readPendingOrderPayment(JSON.stringify({ ...pending, roundItemIds: ['a/b'] }), NOW),
    null,
  );
  assert.equal(readPendingOrderPayment(null, NOW), null);
});

test('복귀 실패·취소는 안내와 체크아웃 복귀만 하고 장바구니는 건드리지 않는다', () => {
  const pending = createPendingOrderPayment({
    paymentId: 'order-1',
    roundItemIds: ['round-item-1'],
    clearCheckoutCart: true,
    retryPath: '/checkout?from=cart',
    now: NOW,
  });
  const failure = parsePaymentRedirectResult(query('paymentId=order-1&code=X&message=취소'));
  assert.deepEqual(resolveOrderPaymentReturn(failure, pending), {
    kind: 'failure',
    message: '취소',
    retryPath: '/checkout?from=cart',
  });
  // 다른 결제의 기록이면 재시도 경로를 주지 않는다.
  const otherFailure = parsePaymentRedirectResult(query('paymentId=order-2&code=X'));
  assert.deepEqual(resolveOrderPaymentReturn(otherFailure, pending), {
    kind: 'failure',
    message: DEFAULT_PAYMENT_FAILURE_MESSAGE,
    retryPath: null,
  });
});

test('복귀 성공 쿼리는 서버 조회 대상 주문 ID만 넘기고, 같은 결제 기록일 때만 장바구니를 정리한다', () => {
  const pending = createPendingOrderPayment({
    paymentId: 'order-1',
    roundItemIds: ['round-item-1', 'round-item-2'],
    clearCheckoutCart: true,
    retryPath: '/checkout?from=cart',
    now: NOW,
  });
  assert.deepEqual(
    resolveOrderPaymentReturn(parsePaymentRedirectResult(query('paymentId=order-1')), pending),
    {
      kind: 'confirm',
      orderId: 'order-1',
      roundItemIds: ['round-item-1', 'round-item-2'],
      clearCheckoutCart: true,
      unpaidItemCount: 0,
    },
  );
  assert.deepEqual(
    resolveOrderPaymentReturn(parsePaymentRedirectResult(query('paymentId=order-9')), pending),
    {
      kind: 'confirm',
      orderId: 'order-9',
      roundItemIds: [],
      clearCheckoutCart: false,
      unpaidItemCount: 0,
    },
  );
  assert.deepEqual(
    resolveOrderPaymentReturn(parsePaymentRedirectResult(query('paymentId=order-1')), null).kind,
    'confirm',
  );
  assert.deepEqual(
    resolveOrderPaymentReturn(
      parsePaymentRedirectResult(query('paymentId=a&paymentId=b')),
      pending,
    ),
    { kind: 'invalid' },
  );
});

test('결제 전 기록은 sessionStorage에 저장하고 복귀 뒤 한 번만 꺼낸다', () => {
  const storage = memoryStorage();
  const pending = createPendingOrderPayment({
    paymentId: 'order-1',
    roundItemIds: ['round-item-1'],
    clearCheckoutCart: true,
    retryPath: '/checkout?from=cart',
    now: NOW,
  });
  savePendingOrderPayment(storage, pending);
  assert.ok(storage.values.has(PENDING_ORDER_PAYMENT_STORAGE_KEY));
  assert.deepEqual(takePendingOrderPayment(storage, NOW + 10), pending);
  assert.equal(storage.values.has(PENDING_ORDER_PAYMENT_STORAGE_KEY), false);
  assert.equal(takePendingOrderPayment(storage, NOW + 10), null);

  savePendingOrderPayment(storage, pending);
  savePendingOrderPayment(storage, null);
  assert.equal(storage.values.has(PENDING_ORDER_PAYMENT_STORAGE_KEY), false);

  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  assert.doesNotThrow(() => savePendingOrderPayment(blocked, pending));
  assert.equal(takePendingOrderPayment(blocked, NOW), null);
  assert.equal(takePendingOrderPayment(null, NOW), null);
});

test('결제 시도가 끝나면 그 시도가 저장한 복귀 기록만 지우고 새 시도의 기록은 남긴다', () => {
  const storage = memoryStorage();
  const previous = createPendingOrderPayment({
    paymentId: 'order-1',
    clearCheckoutCart: true,
    retryPath: '/checkout?from=cart',
    now: NOW,
  });
  const next = createPendingOrderPayment({
    paymentId: 'order-2',
    clearCheckoutCart: true,
    retryPath: '/checkout?from=cart',
    now: NOW + 1_000,
  });

  // 이번 시도가 저장한 기록이면 지운다.
  savePendingOrderPayment(storage, previous);
  assert.equal(
    isOwnPendingOrderPayment(storage.getItem(PENDING_ORDER_PAYMENT_STORAGE_KEY), previous),
    true,
  );
  clearOwnPendingOrderPayment(storage, previous);
  assert.equal(storage.values.has(PENDING_ORDER_PAYMENT_STORAGE_KEY), false);

  // 같은 탭 복귀 뒤 새 결제가 새 기록을 저장했으면 늦게 끝난 이전 시도는 지우지 않는다.
  savePendingOrderPayment(storage, previous);
  savePendingOrderPayment(storage, next);
  clearOwnPendingOrderPayment(storage, previous);
  assert.deepEqual(takePendingOrderPayment(storage, NOW + 2_000), next);

  // 결제 ID가 같아도 저장 시각이 다르면 다른 시도의 기록이다.
  const samePaymentLater = { ...previous, createdAt: NOW + 5_000 };
  savePendingOrderPayment(storage, samePaymentLater);
  clearOwnPendingOrderPayment(storage, previous);
  assert.deepEqual(takePendingOrderPayment(storage, NOW + 6_000), samePaymentLater);

  // 기록이 없거나 손상됐거나, 이번 시도가 저장한 기록이 없으면 지우지 않는다.
  assert.equal(isOwnPendingOrderPayment(null, previous), false);
  assert.equal(isOwnPendingOrderPayment('{', previous), false);
  assert.equal(isOwnPendingOrderPayment('[]', previous), false);
  assert.equal(isOwnPendingOrderPayment(JSON.stringify(previous), null), false);
  savePendingOrderPayment(storage, next);
  clearOwnPendingOrderPayment(storage, null);
  assert.ok(storage.values.has(PENDING_ORDER_PAYMENT_STORAGE_KEY));

  // 저장소가 막혀도 결제 결과 처리를 멈추지 않는다.
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  assert.doesNotThrow(() => clearOwnPendingOrderPayment(blocked, previous));
  assert.doesNotThrow(() => clearOwnPendingOrderPayment(null, previous));
});

test('재배송비 복귀는 서버 paid 확인 전까지 완료로 보지 않는다', () => {
  const success = parsePaymentRedirectResult(query('paymentId=redelivery-1'));
  assert.deepEqual(resolveRedeliveryPaymentReturn(success, undefined), { kind: 'reconciling' });
  assert.deepEqual(resolveRedeliveryPaymentReturn(success, true), { kind: 'done' });
  assert.equal(resolveRedeliveryPaymentReturn(success, false).kind, 'uncertain');
  assert.deepEqual(
    resolveRedeliveryPaymentReturn(
      parsePaymentRedirectResult(query('paymentId=redelivery-1&code=X&message=취소함')),
      false,
    ),
    { kind: 'rejected', message: '취소함' },
  );
  assert.deepEqual(
    resolveRedeliveryPaymentReturn(parsePaymentRedirectResult(query('code=X')), undefined),
    { kind: 'rejected', message: '재배송비 결제가 취소됐어요.' },
  );
  // 서버가 이미 paid로 확인했다면 쿼리보다 서버 상태가 우선이다.
  assert.deepEqual(
    resolveRedeliveryPaymentReturn(parsePaymentRedirectResult(query('code=X')), true),
    { kind: 'done' },
  );
  assert.equal(
    resolveRedeliveryPaymentReturn(
      parsePaymentRedirectResult(query('paymentId=a&paymentId=b')),
      false,
    ).kind,
    'uncertain',
  );
  assert.deepEqual(resolveRedeliveryPaymentReturn(parsePaymentRedirectResult(query('')), true), {
    kind: 'none',
  });
});

test('재배송비 결제가 성공으로 돌아왔는데 서버 확인 전이면 정해진 시간 안에서만 다시 읽는다', () => {
  const MAX = 120_000;
  const success = parsePaymentRedirectResult(query('paymentId=redelivery-1'));
  // 서버 확인 전(false)·아직 못 읽음(undefined)은 다시 읽는다.
  assert.equal(shouldRecheckRedeliveryPayment(success, false, 0, MAX), true);
  assert.equal(shouldRecheckRedeliveryPayment(success, undefined, 60_000, MAX), true);
  // 서버가 확인했거나 시간이 지나면 멈춘다.
  assert.equal(shouldRecheckRedeliveryPayment(success, true, 0, MAX), false);
  assert.equal(shouldRecheckRedeliveryPayment(success, false, MAX, MAX), false);
  assert.equal(shouldRecheckRedeliveryPayment(success, false, Number.NaN, MAX), false);
  // 실패·취소·잘못된 복귀와 복귀 없음은 확정이거나 볼 결제가 없다.
  for (const result of [
    parsePaymentRedirectResult(query('code=X&message=취소함&paymentId=redelivery-1')),
    parsePaymentRedirectResult(query('')),
    null,
  ]) {
    assert.equal(shouldRecheckRedeliveryPayment(result, false, 0, MAX), false);
  }
});

// 화면에 나갈 수 있는 글자(문자열·템플릿 리터럴)를 모은다. 주석은 AST에 없으므로 빠지고,
// 복귀 쿼리의 PG 원문은 리터럴이 아니므로 검사 대상이 아니다(주문 상세 _client.test.mjs와 같은 방식).
function collectScreenStrings(text, fileName) {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const strings = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      strings.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return strings;
}

test('결제 복귀 기본 문구는 판정(kind)을 그대로 두고 해요체 고객 문구로 말한다', () => {
  assert.equal(DEFAULT_PAYMENT_FAILURE_MESSAGE, '결제가 취소됐거나 완료되지 않았어요.');
  assert.deepEqual(
    resolveRedeliveryPaymentReturn(
      parsePaymentRedirectResult(query('paymentId=a&paymentId=b')),
      false,
    ),
    {
      kind: 'uncertain',
      message:
        '재배송비 결제 결과를 확인하지 못했어요. 다시 결제하기 전에 상태를 먼저 확인해 주세요.',
    },
  );
  assert.deepEqual(
    resolveRedeliveryPaymentReturn(
      parsePaymentRedirectResult(query('paymentId=redelivery-1')),
      false,
    ),
    {
      kind: 'uncertain',
      message:
        '결제 요청은 접수됐지만 아직 결제를 확인하지 못했어요. 다시 결제하기 전에 잠시 후 상태를 확인해 주세요.',
    },
  );
});

test('결제 복귀 문자열에는 합니다체·내부 용어가 다시 들어오지 않는다', () => {
  const strings = collectScreenStrings(source, 'payment-redirect.ts');
  // 수집이 실제로 동작하는지 확인한다(기본 실패 문구가 잡혀야 한다).
  assert.ok(strings.includes('결제가 취소됐거나 완료되지 않았어요.'));
  assert.deepEqual(
    strings.filter((value) => /니다|니까|십시오|서버/.test(value)),
    [],
  );
});
