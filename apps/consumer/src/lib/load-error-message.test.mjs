import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./load-error-message.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { CONNECTION_UNSTABLE_MESSAGE, customerLoadErrorMessage, isConnectionFailure } =
  module.exports;

test('브라우저별 연결 실패 원문은 연결 안내로 바꾼다', () => {
  for (const message of [
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'fetch failed',
    'Network request failed',
  ]) {
    assert.equal(isConnectionFailure(new TypeError(message)), true, message);
    assert.equal(customerLoadErrorMessage(new TypeError(message), '상품을'), CONNECTION_UNSTABLE_MESSAGE);
  }
  assert.equal(CONNECTION_UNSTABLE_MESSAGE, '연결이 불안정해요. 잠시 후 다시 시도해 주세요.');
});

test('HTTP 오류·응답 형식 오류는 상태 코드 없이 불러오지 못했다는 안내로 바꾼다', () => {
  assert.equal(
    customerLoadErrorMessage(new Error('서버 오류 500'), '상품을'),
    '상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  );
  assert.equal(
    customerLoadErrorMessage(new SyntaxError('Unexpected token < in JSON'), '상품을'),
    '상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  );
  assert.equal(isConnectionFailure(new Error('서버 오류 503')), false);
});

test('문자열·알 수 없는 값도 받고, 대상이 없으면 "정보를"로 쓴다', () => {
  assert.equal(customerLoadErrorMessage('Failed to fetch'), CONNECTION_UNSTABLE_MESSAGE);
  assert.equal(
    customerLoadErrorMessage(undefined),
    '정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  );
  assert.equal(
    customerLoadErrorMessage({ status: 500 }),
    '정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  );
});

test('결과 문구에 영문 원문·상태 코드·내부 용어가 들어가지 않는다', () => {
  for (const error of [new TypeError('Failed to fetch'), new Error('서버 오류 500'), null]) {
    const message = customerLoadErrorMessage(error, '상품을');
    assert.doesNotMatch(message, /[A-Za-z]|\d|서버/);
  }
});

test('상품 목록 조회 실패는 손님 문구로 바꿔 화면에 넘긴다', async () => {
  const hookSource = await readFile(new URL('../hooks/useProducts.ts', import.meta.url), 'utf8');
  const listHook = hookSource.slice(
    hookSource.indexOf('export function useProducts('),
    hookSource.indexOf('export function useProduct('),
  );
  assert.match(listHook, /setError\(customerLoadErrorMessage\(e, '상품을'\)\)/);
  assert.doesNotMatch(listHook, /setError\(e instanceof Error \? e\.message/);
});
