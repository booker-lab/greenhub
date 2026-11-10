import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  customerResponsibleFeeNotice,
  DEFAULT_REDELIVERY_FEE_KRW,
  deliveryHoldResponsibilityFeeHint,
  formatKrw,
  deliveryHoldSubmitError,
  HOLD_MESSAGE_REQUIRED_MESSAGE,
  HOLD_REASON_REQUIRED_MESSAGE,
  HOLD_WEATHER_DATE_REQUIRED_MESSAGE,
  redeliveryFeeAfterResponsibilityChange,
  HOLD_FEE_NOT_ALLOWED_HINT,
  HOLD_FEE_RANGE_HINT,
  HOLD_FEE_REQUIRED_HINT,
  isRedeliveryFeeWithinLimit,
  MAX_REDELIVERY_FEE_KRW,
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

test('재배송비는 서버 상한(50,000원) 이하의 정수만 받고, 넘으면 저장을 막고 안내한다', () => {
  assert.equal(MAX_REDELIVERY_FEE_KRW, 50_000);
  assert.equal(HOLD_FEE_RANGE_HINT, '재배송비는 50,000원 이하의 정수로 입력해 주세요.');
  assert.equal(isRedeliveryFeeWithinLimit(null), true);
  assert.equal(isRedeliveryFeeWithinLimit(MAX_REDELIVERY_FEE_KRW), true);
  assert.equal(isRedeliveryFeeWithinLimit(MAX_REDELIVERY_FEE_KRW + 1), false);
  assert.equal(isRedeliveryFeeWithinLimit(1500.5), false);
  for (const reasonCode of NON_WEATHER) {
    for (const redeliveryFee of [1, '3000', MAX_REDELIVERY_FEE_KRW, '50000']) {
      assert.equal(
        deliveryHoldResponsibilityFeeHint({ reasonCode, customerResponsible: true, redeliveryFee }),
        null,
        String(redeliveryFee),
      );
    }
    for (const redeliveryFee of [MAX_REDELIVERY_FEE_KRW + 1, '50001', 1500.5, '3000.5', '1e21']) {
      assert.equal(
        deliveryHoldResponsibilityFeeHint({ reasonCode, customerResponsible: true, redeliveryFee }),
        HOLD_FEE_RANGE_HINT,
        String(redeliveryFee),
      );
    }
  }
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

test('D-09. 고객 책임을 고르면 비어 있는 재배송비에 기준 금액 10,000원을 채우고, 풀면 비운다', () => {
  assert.equal(DEFAULT_REDELIVERY_FEE_KRW, 10_000);
  assert.ok(DEFAULT_REDELIVERY_FEE_KRW <= MAX_REDELIVERY_FEE_KRW);
  for (const redeliveryFee of ['', 0, '0']) {
    assert.equal(
      redeliveryFeeAfterResponsibilityChange({ customerResponsible: true, redeliveryFee }),
      DEFAULT_REDELIVERY_FEE_KRW,
    );
  }
  // 이미 적은 금액은 그대로 둔다(기사가 바꿀 수 있다).
  assert.equal(
    redeliveryFeeAfterResponsibilityChange({ customerResponsible: true, redeliveryFee: 3000 }),
    3000,
  );
  for (const redeliveryFee of ['', 3000, DEFAULT_REDELIVERY_FEE_KRW]) {
    assert.equal(
      redeliveryFeeAfterResponsibilityChange({ customerResponsible: false, redeliveryFee }),
      '',
    );
  }
  // 채운 기준 금액은 책임·상한 검사를 그대로 통과한다.
  for (const reasonCode of NON_WEATHER) {
    assert.equal(
      deliveryHoldResponsibilityFeeHint({
        reasonCode,
        customerResponsible: true,
        redeliveryFee: DEFAULT_REDELIVERY_FEE_KRW,
      }),
      null,
    );
  }
});

test('D-07. 유형 기본 선택이 없고, 고르지 않으면 저장 전에 고르게 한다', () => {
  assert.equal(
    deliveryHoldSubmitError({ reasonCode: null, reasonMessage: '사유', nextDeliveryAt: '' }),
    HOLD_REASON_REQUIRED_MESSAGE,
  );
  assert.equal(HOLD_REASON_REQUIRED_MESSAGE, '보류 유형을 골라 주세요.');
  assert.equal(
    deliveryHoldSubmitError({
      reasonCode: 'ACCESS_UNAVAILABLE',
      reasonMessage: '  ',
      nextDeliveryAt: '',
    }),
    HOLD_MESSAGE_REQUIRED_MESSAGE,
  );
  assert.equal(
    deliveryHoldSubmitError({ reasonCode: 'WEATHER', reasonMessage: '강풍', nextDeliveryAt: '' }),
    HOLD_WEATHER_DATE_REQUIRED_MESSAGE,
  );
  assert.equal(
    deliveryHoldSubmitError({
      reasonCode: 'WEATHER',
      reasonMessage: '강풍',
      nextDeliveryAt: '2026-07-22T08:00',
    }),
    null,
  );
  assert.equal(
    deliveryHoldSubmitError({
      reasonCode: 'CUSTOMER_UNREACHABLE',
      reasonMessage: '부재',
      nextDeliveryAt: '',
    }),
    null,
  );
  // 모달 상태는 미선택(null)으로 시작·초기화하고, 저장은 미선택을 보내기 전에 돌려보낸다.
  assert.match(holdModalSource, /useState<HoldReason \| null>\(null\)/);
  assert.doesNotMatch(holdModalSource, /setReasonCode\('WEATHER'\)/);
  const fnAt = holdModalSource.indexOf('async function submit');
  const guardAt = holdModalSource.indexOf('if (inputError || !reasonCode)', fnAt);
  const payloadAt = holdModalSource.indexOf('const deliveryHold = {', fnAt);
  assert.ok(guardAt !== -1 && guardAt < payloadAt, '유형 검사가 payload보다 먼저다');
});

test('D-08·D-15·D-24. 보류 창 이름·사유 안내·오류 지움', () => {
  assert.match(holdModalSource, /<DialogTitle[^>]*>배송 보류<\/DialogTitle>/);
  assert.match(holdModalSource, />\s*보류하기\s*</);
  assert.match(holdModalSource, /label="손님에게 보일 사유"/);
  assert.match(
    holdModalSource,
    /손님 주문 화면에 그대로 보여요\. 저장하면 손님에게 배송 보류 알림이 가요\./,
  );
  assert.match(holdModalSource, /aria-describedby=\{reasonHelpId\}/);
  // 고객 책임 체크는 기준 금액 판단을 거친다.
  assert.match(holdModalSource, /onChange=\{changeCustomerResponsible\}/);
  assert.match(holdModalSource, /redeliveryFeeAfterResponsibilityChange\(/);
  // 유형·사유·책임·재배송비·일정이 바뀌면 이전 제출 오류를 지운다.
  const changeReasonAt = holdModalSource.indexOf('function changeReason');
  const changeResponsibleAt = holdModalSource.indexOf('function changeCustomerResponsible');
  assert.match(holdModalSource.slice(changeReasonAt, changeReasonAt + 120), /setError\(''\)/);
  assert.match(
    holdModalSource.slice(changeResponsibleAt, changeResponsibleAt + 160),
    /setError\(''\)/,
  );
  const formAt = holdModalSource.indexOf('<RadioGroupField');
  const formEnd = holdModalSource.indexOf('{error &&', formAt);
  assert.equal((holdModalSource.slice(formAt, formEnd).match(/setError\(''\)/g) ?? []).length, 4);
});

test('R-02. 금액은 천 단위로 구분해 원을 붙인다', () => {
  assert.equal(formatKrw(10000), '10,000원');
  assert.equal(formatKrw(3000), '3,000원');
  assert.equal(formatKrw(500), '500원');
  assert.equal(formatKrw(MAX_REDELIVERY_FEE_KRW), '50,000원');
});

test('R-02. 고객 책임이면 재배송비 칸 아래에 금액·재개 잠금·수정 불가를 알린다', () => {
  for (const reasonCode of NON_WEATHER) {
    assert.equal(
      customerResponsibleFeeNotice({
        reasonCode,
        customerResponsible: true,
        redeliveryFee: DEFAULT_REDELIVERY_FEE_KRW,
      }),
      '손님이 재배송비 10,000원을 결제해야 다시 배송할 수 있어요. 저장한 뒤에는 기사 앱에서 바꿀 수 없어요.',
      reasonCode,
    );
  }
  // 금액은 지금 입력값을 따른다(문자열 입력 포함).
  assert.equal(
    customerResponsibleFeeNotice({
      reasonCode: 'ACCESS_UNAVAILABLE',
      customerResponsible: true,
      redeliveryFee: '3000',
    }),
    '손님이 재배송비 3,000원을 결제해야 다시 배송할 수 있어요. 저장한 뒤에는 기사 앱에서 바꿀 수 없어요.',
  );
  // 고객 책임 아님·기상 보류(고객 책임 잠금)는 안내하지 않는다.
  assert.equal(
    customerResponsibleFeeNotice({
      reasonCode: 'ACCESS_UNAVAILABLE',
      customerResponsible: false,
      redeliveryFee: 3000,
    }),
    null,
  );
  assert.equal(
    customerResponsibleFeeNotice({ reasonCode: 'WEATHER', customerResponsible: true, redeliveryFee: 3000 }),
    null,
  );
  // 금액 없음·상한 초과·정수 아님은 고칠 방법 안내(deliveryHoldResponsibilityFeeHint)만 보인다.
  for (const redeliveryFee of ['', 0, MAX_REDELIVERY_FEE_KRW + 1, 1500.5]) {
    assert.equal(
      customerResponsibleFeeNotice({
        reasonCode: 'ADDRESS_ISSUE',
        customerResponsible: true,
        redeliveryFee,
      }),
      null,
      String(redeliveryFee),
    );
    assert.notEqual(
      deliveryHoldResponsibilityFeeHint({
        reasonCode: 'ADDRESS_ISSUE',
        customerResponsible: true,
        redeliveryFee,
      }),
      null,
      String(redeliveryFee),
    );
  }
  // 유형을 아직 고르지 않았어도 고객 책임·금액이 맞으면 결과를 미리 알린다.
  assert.match(
    customerResponsibleFeeNotice({ reasonCode: null, customerResponsible: true, redeliveryFee: 10000 }) ?? '',
    /10,000원/,
  );
});

test('R-02·R-09. 보류 창은 재배송비 칸 바로 아래에 고객 책임 안내를 두고, 도움말은 낱말 단위로 줄을 바꾼다', () => {
  assert.match(holdModalSource, /const customerFeeNotice = customerResponsibleFeeNotice\(\{/);
  const feeFieldAt = holdModalSource.indexOf('<NumberField');
  const feeFieldEnd = holdModalSource.indexOf('/>', feeFieldAt);
  const noticeAt = holdModalSource.indexOf('{customerFeeNotice && (', feeFieldEnd);
  const hintAt = holdModalSource.indexOf('{responsibilityFeeHint && (', feeFieldEnd);
  const nextFieldAt = holdModalSource.indexOf('<TextField', feeFieldEnd);
  assert.ok(feeFieldAt !== -1 && noticeAt !== -1 && hintAt !== -1);
  assert.ok(noticeAt < hintAt && hintAt < nextFieldAt, '안내는 재배송비 칸 바로 아래에 있다');
  // 기준 금액 미리 채움·상한·기상 잠금은 그대로다.
  const feeField = holdModalSource.slice(feeFieldAt, feeFieldEnd);
  assert.match(feeField, /disabled=\{isWeather\}/);
  assert.match(feeField, /value=\{redeliveryFee\}/);
  assert.match(
    holdModalSource,
    /redeliveryFeeAfterResponsibilityChange\(\{ customerResponsible: checked, redeliveryFee \}\)/,
  );
  assert.match(
    holdModalSource,
    /redeliveryFee: isWeather \? null : parseRedeliveryFee\(redeliveryFee\)/,
  );
  // 안내·도움말은 낱말 중간에서 끊기지 않는다.
  assert.match(
    holdModalSource,
    /const keepWords = \{ wordBreak: 'keep-all', overflowWrap: 'anywhere' \} as const;/,
  );
  const helpAt = holdModalSource.indexOf('id={reasonHelpId}');
  assert.match(holdModalSource.slice(helpAt, helpAt + 200), /style=\{keepWords\}/);
  assert.match(holdModalSource.slice(noticeAt, noticeAt + 200), /style=\{keepWords\}/);
});
