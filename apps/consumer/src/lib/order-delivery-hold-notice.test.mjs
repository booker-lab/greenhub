import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadModule() {
  const fileName = 'order-delivery-hold-notice.ts';
  const source = await readFile(new URL(`./${fileName}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (specifier) => {
      throw new Error(`예상하지 못한 모듈 요청: ${specifier}`);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const { deliveryHoldNotice, REDELIVERY_FREE_LINE, REDELIVERY_UNPAID_NOTICE } = await loadModule();

test('기상 보류는 재배송비 없음과 함께 미뤘다고 안내한다', () => {
  assert.deepEqual(
    deliveryHoldNotice({
      reasonCode: 'WEATHER',
      customerResponsible: false,
      redeliveryFee: null,
      redeliveryPaid: false,
    }),
    {
      title: '날씨 때문에 배송을 미뤘어요',
      lines: ['안전한 배송이 어려워 배송을 미뤘어요.', REDELIVERY_FREE_LINE],
    },
  );
});

test('고객 책임 보류는 사유별 제목과 재배송비 결제 안내를 보인다', () => {
  const cases = [
    [
      'ACCESS_UNAVAILABLE',
      '출입이 어려워 배송하지 못했어요',
      '공동현관·출입 방법을 확인하지 못해 배송하지 못했어요.',
    ],
    [
      'ADDRESS_ISSUE',
      '주소를 찾지 못해 배송하지 못했어요',
      '적어 주신 주소로 배송지를 찾지 못했어요.',
    ],
    [
      'CUSTOMER_UNREACHABLE',
      '연락이 닿지 않아 배송하지 못했어요',
      '받는 분과 연락이 닿지 않아 배송하지 못했어요.',
    ],
    ['OTHER', '배송하지 못했어요', '배송을 진행하지 못했어요.'],
  ];
  for (const [reasonCode, title, sentence] of cases) {
    assert.deepEqual(
      deliveryHoldNotice({
        reasonCode,
        customerResponsible: true,
        redeliveryFee: 3000,
        redeliveryPaid: false,
      }),
      { title, lines: [sentence, '재배송비 3,000원을 결제하면 다시 배송해요.'] },
      reasonCode,
    );
  }
});

test('재배송비를 이미 결제했으면 결제 요청 문장을 빼고 사유만 남긴다', () => {
  assert.deepEqual(
    deliveryHoldNotice({
      reasonCode: 'ADDRESS_ISSUE',
      customerResponsible: true,
      redeliveryFee: 3000,
      redeliveryPaid: true,
    }).lines,
    ['적어 주신 주소로 배송지를 찾지 못했어요.'],
  );
});

test('고객 책임이 아닌 보류는 재배송비가 없다고 안내하고, 그 밖 사유는 저희 사정이라고 말한다', () => {
  assert.deepEqual(
    deliveryHoldNotice({
      reasonCode: 'OTHER',
      customerResponsible: false,
      redeliveryFee: null,
      redeliveryPaid: false,
    }),
    {
      title: '배송을 잠시 미뤘어요',
      lines: ['저희 사정으로 배송이 늦어지고 있어요.', REDELIVERY_FREE_LINE],
    },
  );
  assert.deepEqual(
    deliveryHoldNotice({
      reasonCode: 'ACCESS_UNAVAILABLE',
      customerResponsible: false,
      redeliveryFee: null,
      redeliveryPaid: false,
    }).lines,
    ['공동현관·출입 방법을 확인하지 못해 배송하지 못했어요.', REDELIVERY_FREE_LINE],
  );
});

test('수령 거부는 다른 고객 사유처럼 사유 문구와 재배송비 결제 안내를 보인다', () => {
  assert.deepEqual(
    deliveryHoldNotice({
      reasonCode: 'RECEIPT_REFUSED',
      customerResponsible: true,
      redeliveryFee: 10000,
      redeliveryPaid: false,
    }),
    {
      title: '수령을 거부하셔서 배송하지 못했어요',
      lines: [
        '받는 분이 상품 수령을 거부하셔서 배송하지 못했어요.',
        '재배송비 10,000원을 결제하면 다시 배송해요.',
      ],
    },
  );
});

test('상품 파손은 가게 취소·환불 안내만 보이고 재배송비 없음 줄을 붙이지 않는다', () => {
  const notice = deliveryHoldNotice({
    reasonCode: 'PRODUCT_DAMAGED',
    customerResponsible: false,
    redeliveryFee: null,
    redeliveryPaid: false,
  });
  assert.deepEqual(notice, {
    title: '상품이 파손돼 배송하지 못했어요',
    lines: ['배송 중 상품이 파손돼 배송하지 못했어요. 가게에서 주문 취소·환불을 진행해요.'],
  });
  assert.ok(!notice.lines.includes(REDELIVERY_FREE_LINE));
});

test('어떤 문구에도 내부 용어(고객 책임·보류 코드)가 드러나지 않는다', () => {
  for (const reasonCode of [
    'WEATHER',
    'ACCESS_UNAVAILABLE',
    'ADDRESS_ISSUE',
    'CUSTOMER_UNREACHABLE',
    'RECEIPT_REFUSED',
    'PRODUCT_DAMAGED',
    'OTHER',
  ]) {
    for (const customerResponsible of [true, false]) {
      const notice = deliveryHoldNotice({
        reasonCode,
        customerResponsible,
        redeliveryFee: customerResponsible ? 5000 : null,
        redeliveryPaid: false,
      });
      const text = [notice.title, ...notice.lines, REDELIVERY_UNPAID_NOTICE].join(' ');
      assert.doesNotMatch(text, /고객 책임|[A-Z_]{4,}/, `${reasonCode}/${customerResponsible}`);
    }
  }
});
