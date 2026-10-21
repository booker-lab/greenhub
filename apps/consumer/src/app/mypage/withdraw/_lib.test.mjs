import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_lib.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: '_lib.ts',
}).outputText;
const libModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => {
    throw new Error('예상하지 못한 모듈 요청');
  },
  libModule,
  libModule.exports,
);
const {
  WITHDRAW_ACTIVE_ORDER_FALLBACK,
  WITHDRAW_ERASED_ITEMS,
  WITHDRAW_FAILED_MESSAGE,
  WITHDRAW_KEPT_ITEMS,
  requestWithdrawal,
} = libModule.exports;

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('탈퇴 요청은 access token을 실어 DELETE /auth/me를 부른다', async () => {
  const calls = [];
  const result = await requestWithdrawal('https://api.example', 'token-1', async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(204, null);
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, 'https://api.example/auth/me');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token-1');
});

test('409(진행 중 주문)는 서버 안내 문구를 그대로 보여 준다', async () => {
  const message = '진행 중인 주문이 있어 탈퇴할 수 없습니다.';
  const result = await requestWithdrawal('', 't', async () => jsonResponse(409, { message }));
  assert.deepEqual(result, { ok: false, message });

  const fallback = await requestWithdrawal('', 't', async () => jsonResponse(409, {}));
  assert.deepEqual(fallback, { ok: false, message: WITHDRAW_ACTIVE_ORDER_FALLBACK });
});

test('그 밖의 실패와 네트워크 오류는 고정 문구로 바꾼다', async () => {
  const serverError = await requestWithdrawal('', 't', async () =>
    jsonResponse(500, { message: '내부 오류 상세' }),
  );
  assert.deepEqual(serverError, { ok: false, message: WITHDRAW_FAILED_MESSAGE });

  const network = await requestWithdrawal('', 't', async () => {
    throw new TypeError('network');
  });
  assert.deepEqual(network, { ok: false, message: WITHDRAW_FAILED_MESSAGE });
});

test('안내는 지워지는 정보와 5년 보관되는 주문·결제 기록을 함께 알린다', () => {
  assert.ok(WITHDRAW_ERASED_ITEMS.some((item) => item.includes('배송지')));
  assert.ok(WITHDRAW_ERASED_ITEMS.some((item) => item.includes('카카오')));
  assert.ok(WITHDRAW_KEPT_ITEMS.some((item) => item.includes('5년')));
});
