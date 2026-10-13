import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./checkout-prefill.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'checkout-prefill.ts',
}).outputText;
const prefillModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    throw new Error(`예상하지 못한 자동 채움 모듈 요청: ${specifier}`);
  },
  prefillModule,
  prefillModule.exports,
);
const { pickCheckoutPrefill, prefillAddress, prefillPhone } = prefillModule.exports;

const empty = { address: { address: '', addressDetail: '', zipCode: '' }, phone: '' };

test('기본 배송지와 프로필 전화번호를 고른다', () => {
  const prefill = pickCheckoutPrefill({
    phone: ' 010-1234-5678 ',
    savedAddresses: [
      {
        id: 'a',
        label: '회사',
        address: '경기도 이천시 A',
        addressDetail: '1층',
        zipCode: '17373',
        isDefault: false,
      },
      {
        id: 'b',
        label: '집',
        address: '경기도 이천시 B',
        addressDetail: '201호',
        zipCode: '17374',
        isDefault: true,
      },
    ],
  });
  assert.deepEqual(prefill, {
    address: { address: '경기도 이천시 B', addressDetail: '201호', zipCode: '17374' },
    phone: '010-1234-5678',
  });
});

test('기본 배송지가 없으면 첫 배송지, 손상된 배송지와 빈 값은 쓰지 않는다', () => {
  assert.deepEqual(
    pickCheckoutPrefill({
      savedAddresses: [
        { address: '', zipCode: '1' },
        { address: '경기도 이천시 C', addressDetail: '', zipCode: '17375', isDefault: false },
      ],
      phone: '',
    }),
    { address: { address: '경기도 이천시 C', addressDetail: '', zipCode: '17375' }, phone: null },
  );
  assert.deepEqual(pickCheckoutPrefill(null), { address: null, phone: null });
  assert.deepEqual(pickCheckoutPrefill({ savedAddresses: 'x' }), { address: null, phone: null });
});

test('이미 입력한 칸은 덮지 않는다', () => {
  const prefill = {
    address: { address: '경기도 이천시 B', addressDetail: '201호', zipCode: '17374' },
    phone: '010-1234-5678',
  };
  assert.deepEqual(prefillAddress(empty.address, prefill), prefill.address);
  assert.equal(prefillPhone('', prefill), '010-1234-5678');
  const typedAddress = { address: '', addressDetail: '303호', zipCode: '' };
  assert.deepEqual(prefillAddress(typedAddress, prefill), typedAddress);
  assert.equal(prefillPhone('010-9999-9999', prefill), '010-9999-9999');
  assert.deepEqual(prefillAddress(empty.address, { address: null, phone: null }), empty.address);
});
