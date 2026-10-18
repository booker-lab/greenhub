import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./round-wishlist.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(() => ({}), mod, mod.exports);
const { readRoundWish, toggleRoundWish, roundWishKey, ROUND_WISH_KEY_PREFIX } = mod.exports;

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

test('이번 회차 찜을 켜고 끈다', () => {
  const storage = memoryStorage();
  assert.deepEqual(toggleRoundWish(storage, 'round-a', 'p1'), ['p1']);
  assert.deepEqual(toggleRoundWish(storage, 'round-a', 'p2'), ['p2', 'p1']);
  assert.deepEqual(toggleRoundWish(storage, 'round-a', 'p1'), ['p2']);
  assert.deepEqual(readRoundWish(storage, 'round-a'), ['p2']);
});

test('다른 회차의 찜은 새 회차에서 찜할 때 지운다', () => {
  const storage = memoryStorage({ [roundWishKey('round-old')]: JSON.stringify(['p9']), other: 'keep' });
  assert.deepEqual(readRoundWish(storage, 'round-new'), []);
  toggleRoundWish(storage, 'round-new', 'p1');
  assert.equal(storage.getItem(roundWishKey('round-old')), null);
  assert.equal(storage.getItem('other'), 'keep');
  assert.ok([...storage.map.keys()].filter((k) => k.startsWith(ROUND_WISH_KEY_PREFIX)).length === 1);
});

test('깨진 기록·저장소 없음은 빈 목록', () => {
  assert.deepEqual(readRoundWish(memoryStorage({ [roundWishKey('r')]: '{oops' }), 'r'), []);
  assert.deepEqual(readRoundWish(null, 'r'), []);
  assert.deepEqual(readRoundWish(memoryStorage(), null), []);
  assert.deepEqual(toggleRoundWish(null, 'r', 'p1'), ['p1']);
});
