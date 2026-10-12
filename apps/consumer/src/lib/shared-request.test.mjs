import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./shared-request.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { sharedRequest, clearSharedRequests } = module.exports;

function counter(result) {
  let calls = 0;
  return {
    load: async () => {
      calls += 1;
      return typeof result === 'function' ? result(calls) : result;
    },
    calls: () => calls,
  };
}

test('같은 키를 동시에 부르면 요청을 한 번만 보내고 같은 결과를 나눠 준다', async () => {
  clearSharedRequests();
  const req = counter(['p1']);
  const [a, b, c] = await Promise.all([
    sharedRequest('products', req.load, { ttlMs: 5000 }),
    sharedRequest('products', req.load, { ttlMs: 5000 }),
    sharedRequest('products', req.load, { ttlMs: 5000 }),
  ]);
  assert.equal(req.calls(), 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('공유 기간이 지나면 다시 보낸다', async () => {
  clearSharedRequests();
  let now = 1_000;
  const req = counter((n) => n);
  assert.equal(await sharedRequest('k', req.load, { ttlMs: 5000, now: () => now }), 1);
  now += 4_999;
  assert.equal(await sharedRequest('k', req.load, { ttlMs: 5000, now: () => now }), 1);
  now += 1;
  assert.equal(await sharedRequest('k', req.load, { ttlMs: 5000, now: () => now }), 2);
});

test('실패한 요청은 공유하지 않아 다음 호출이 다시 보낸다', async () => {
  clearSharedRequests();
  let calls = 0;
  const load = async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return 'ok';
  };
  await assert.rejects(sharedRequest('k', load, { ttlMs: 60_000 }), /offline/);
  assert.equal(await sharedRequest('k', load, { ttlMs: 60_000 }), 'ok');
  assert.equal(calls, 2);
});

test('fresh는 공유된 결과를 쓰지 않고 새로 보내고, 이후 호출은 새 결과를 공유한다', async () => {
  clearSharedRequests();
  const req = counter((n) => n);
  assert.equal(await sharedRequest('k', req.load, { ttlMs: 60_000 }), 1);
  assert.equal(await sharedRequest('k', req.load, { ttlMs: 60_000, fresh: true }), 2);
  assert.equal(await sharedRequest('k', req.load, { ttlMs: 60_000 }), 2);
  assert.equal(req.calls(), 2);
});

test('키가 다르면 따로 보낸다', async () => {
  clearSharedRequests();
  const req = counter((n) => n);
  await Promise.all([
    sharedRequest('a', req.load, { ttlMs: 5000 }),
    sharedRequest('b', req.load, { ttlMs: 5000 }),
  ]);
  assert.equal(req.calls(), 2);
});

test('상품 목록 공유 결과는 복사한 뒤 정렬하고, 다시 불러오기는 새로 받는다', async () => {
  const hook = await readFile(new URL('../hooks/useProducts.ts', import.meta.url), 'utf8');
  assert.match(hook, /const items: Product\[\] = \[\.\.\.\(list as Product\[\]\)\];/);
  assert.match(hook, /fresh: tick > 0/);
});
