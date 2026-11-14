import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./checkout-address.ts', import.meta.url), 'utf8');
const loaded = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(loaded, loaded.exports);
const {
  ADDRESS_MAX_LENGTH,
  hasDeliveryAddress,
  isIcheonAddressPrefix,
  normalizeManualAddress,
  normalizeManualZipCode,
  readPostcodeConstructor,
} = loaded.exports;

test('배송지 주소는 주소만 있으면 결제할 수 있고, 직접 입력에서는 우편번호가 비어도 된다', () => {
  assert.equal(
    hasDeliveryAddress({ address: '경기도 이천시 중리천로 100', zipCode: '17379' }),
    true,
  );
  assert.equal(hasDeliveryAddress({ address: '경기도 이천시 중리천로 100', zipCode: '' }), true);
  assert.equal(hasDeliveryAddress({ address: '   ', zipCode: '17379' }), false);
  assert.equal(hasDeliveryAddress({ address: '', zipCode: '' }), false);
});

test('직접 입력 주소는 앞 공백과 연속 공백을 정리하고 서버 상한(200자)을 넘지 않는다', () => {
  assert.equal(
    normalizeManualAddress('  경기도   이천시  중리천로 100'),
    '경기도 이천시 중리천로 100',
  );
  // 입력 중 끝 공백은 남겨 다음 단어를 이어 적을 수 있게 한다.
  assert.equal(normalizeManualAddress('경기도 '), '경기도 ');
  assert.equal(normalizeManualAddress('가'.repeat(250)).length, ADDRESS_MAX_LENGTH);
});

test('직접 입력 우편번호는 숫자 5자리까지만 받는다', () => {
  assert.equal(normalizeManualZipCode('173-79'), '17379');
  assert.equal(normalizeManualZipCode('1737912'), '17379');
  assert.equal(normalizeManualZipCode('우편'), '');
});

test('이천 주소를 다 적기 전("경기도 이")에는 접두로 보고, 다른 지역은 접두가 아니다', () => {
  for (const typed of ['', '경', '경기', '경기도 이', '경기 이천', '이천', '이천시']) {
    assert.equal(isIcheonAddressPrefix(typed), true, typed);
  }
  for (const typed of ['서울', '경기도 수원시', '경기도 이천시 중리천로', '부산시']) {
    assert.equal(isIcheonAddressPrefix(typed), false, typed);
  }
});

test('우편번호 스크립트가 없거나 형태가 다르면 검색 대신 직접 입력으로 넘어간다', () => {
  assert.equal(readPostcodeConstructor(undefined), null);
  assert.equal(readPostcodeConstructor({}), null);
  assert.equal(readPostcodeConstructor({ daum: {} }), null);
  assert.equal(readPostcodeConstructor({ daum: { Postcode: 'x' } }), null);
  function Postcode() {}
  assert.equal(readPostcodeConstructor({ daum: { Postcode } }), Postcode);
});
