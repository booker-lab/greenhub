import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  deliveryHoldResponsibilityFeeHint,
  HOLD_FEE_NOT_ALLOWED_HINT,
  HOLD_FEE_REQUIRED_HINT,
  parseRedeliveryFee,
} from './delivery-hold-form.ts';

const holdModalSource = await readFile(
  new URL('../[orderId]/_components/DeliveryHoldModal.tsx', import.meta.url),
  'utf8',
);

const NON_WEATHER = ['ACCESS_UNAVAILABLE', 'ADDRESS_ISSUE', 'CUSTOMER_UNREACHABLE'];

test('재배송비 입력값: 0원보다 큰 숫자만 재배송비다', () => {
  assert.equal(parseRedeliveryFee(3000), 3000);
  assert.equal(parseRedeliveryFee('3000'), 3000);
  for (const value of ['', ' ', 0, '0', -1000, 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parseRedeliveryFee(value), null, String(value));
  }
});

test('기상 외 보류: 고객 책임인데 재배송비가 없으면 저장을 막고 입력을 안내한다', () => {
  for (const reasonCode of NON_WEATHER) {
    for (const redeliveryFee of ['', 0, '0']) {
      assert.equal(
        deliveryHoldResponsibilityFeeHint({ reasonCode, customerResponsible: true, redeliveryFee }),
        HOLD_FEE_REQUIRED_HINT,
      );
    }
  }
});

test('기상 외 보류: 고객 책임이 아닌데 재배송비가 있으면 저장을 막고 안내한다', () => {
  for (const reasonCode of NON_WEATHER) {
    assert.equal(
      deliveryHoldResponsibilityFeeHint({
        reasonCode,
        customerResponsible: false,
        redeliveryFee: 3000,
      }),
      HOLD_FEE_NOT_ALLOWED_HINT,
    );
  }
});

test('책임과 재배송비가 맞거나 기상 보류면 안내 없이 저장할 수 있다', () => {
  for (const reasonCode of NON_WEATHER) {
    assert.equal(
      deliveryHoldResponsibilityFeeHint({
        reasonCode,
        customerResponsible: true,
        redeliveryFee: 3000,
      }),
      null,
    );
    assert.equal(
      deliveryHoldResponsibilityFeeHint({
        reasonCode,
        customerResponsible: false,
        redeliveryFee: '',
      }),
      null,
    );
  }
  // 기상 보류는 모달이 두 칸을 잠그고 보낼 때 고객 책임 false·재배송비 null로 고정한다.
  assert.equal(
    deliveryHoldResponsibilityFeeHint({
      reasonCode: 'WEATHER',
      customerResponsible: true,
      redeliveryFee: 3000,
    }),
    null,
  );
});

test('보류 모달은 어긋난 책임·재배송비를 저장 버튼에서 막고 입력칸 아래에 안내한다', () => {
  assert.match(
    holdModalSource,
    /const responsibilityFeeHint = deliveryHoldResponsibilityFeeHint\(\{/,
  );
  assert.match(holdModalSource, /disabled=\{loading \|\| responsibilityFeeHint !== null\}/);
  assert.match(holdModalSource, /\{responsibilityFeeHint && \(/);
  // 보내는 재배송비도 같은 판단으로 읽는다.
  assert.match(
    holdModalSource,
    /redeliveryFee: isWeather \? null : parseRedeliveryFee\(redeliveryFee\)/,
  );
  // submit도 PATCH 전에 어긋난 조합을 돌려보낸다.
  const fnAt = holdModalSource.indexOf('async function submit');
  const guardAt = holdModalSource.indexOf('if (responsibilityFeeHint) return;', fnAt);
  const patchAt = holdModalSource.indexOf("method: 'PATCH'", fnAt);
  assert.ok(guardAt !== -1 && guardAt < patchAt);
});
