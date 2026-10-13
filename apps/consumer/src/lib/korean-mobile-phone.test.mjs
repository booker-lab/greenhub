import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./korean-mobile-phone.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'korean-mobile-phone.ts',
}).outputText;
const phoneModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (specifier) => {
    throw new Error(`예상하지 못한 휴대폰 번호 모듈 요청: ${specifier}`);
  },
  phoneModule,
  phoneModule.exports,
);
const { isKoreanMobilePhone } = phoneModule.exports;

test('API와 같은 휴대폰 번호 형식을 받는다', () => {
  for (const value of [
    '010-1234-5678',
    '01012345678',
    ' 010 1234 5678 ',
    '(010)1234-5678',
    '+82 10-1234-5678',
    '011-123-4567',
  ]) {
    assert.equal(isKoreanMobilePhone(value), true, value);
  }
});

test('휴대폰이 아니거나 자릿수가 맞지 않는 번호는 거절한다', () => {
  for (const value of [
    '00000000',
    '1234-5678',
    '010-123-567',
    '010-123-4567',
    '0101234567',
    '02-123-4567',
    '031-123-4567',
    '010-1234-56789',
    '',
  ]) {
    assert.equal(isKoreanMobilePhone(value), false, value);
  }
});
