import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./payment-checkout-draft.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'payment-checkout-draft.ts',
}).outputText;
const draftModule = { exports: {} };
new Function('module', 'exports', compiled)(draftModule, draftModule.exports);
const {
  CHECKOUT_DRAFT_STORAGE_KEY,
  checkoutDraftCartKey,
  clearCheckoutDraft,
  loadCheckoutDraft,
  readCheckoutDraft,
  saveCheckoutDraft,
} = draftModule.exports;

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const OWNER = 'user-a';

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const draft = {
  address: { address: '경기도 이천시 중리천로 1', addressDetail: '101호', zipCode: '17379' },
  deliveryPhone: '010-2222-3333',
  requestNote: '경비실에 맡겨 주세요',
  packageLabel: { enabled: true, text: '개업 축하' },
};

const items = [
  { roundId: 'round-1', roundItemId: 'round-item-2' },
  { roundId: 'round-1', roundItemId: 'round-item-1' },
];

test('장바구니 키는 회차와 회차 상품 목록으로 정하고 순서에 흔들리지 않는다', () => {
  assert.equal(checkoutDraftCartKey(items), 'round-1:round-item-1,round-item-2');
  assert.equal(checkoutDraftCartKey([...items].reverse()), checkoutDraftCartKey(items));
  assert.notEqual(checkoutDraftCartKey(items.slice(0, 1)), checkoutDraftCartKey(items));
});

test('저장한 입력값을 같은 장바구니로 다시 열면 그대로 복원한다', () => {
  const storage = createStorage();
  const cartKey = checkoutDraftCartKey(items);
  saveCheckoutDraft(storage, draft, cartKey, OWNER, NOW);

  assert.ok(storage.values.has(CHECKOUT_DRAFT_STORAGE_KEY));
  assert.deepEqual(loadCheckoutDraft(storage, cartKey, OWNER, NOW + HOUR), draft);
});

test('다른 장바구니·만료·미래 시각·손상 기록은 복원하지 않는다', () => {
  const storage = createStorage();
  const cartKey = checkoutDraftCartKey(items);
  saveCheckoutDraft(storage, draft, cartKey, OWNER, NOW);
  const raw = storage.getItem(CHECKOUT_DRAFT_STORAGE_KEY);

  assert.equal(readCheckoutDraft(raw, 'round-2:round-item-9', OWNER, NOW), null);
  assert.equal(readCheckoutDraft(raw, cartKey, OWNER, NOW + 2 * HOUR + 1), null);
  assert.equal(readCheckoutDraft(raw, cartKey, OWNER, NOW - 1), null);
  assert.equal(readCheckoutDraft('{', cartKey, OWNER, NOW), null);
  assert.equal(readCheckoutDraft(null, cartKey, OWNER, NOW), null);
  const stored = JSON.parse(raw);
  for (const broken of [
    { ...stored, version: 3 },
    { ...stored, ownerId: undefined },
    { ...stored, deliveryPhone: 1234 },
    { ...stored, address: { ...stored.address, zipCode: null } },
    { ...stored, packageLabel: { enabled: 'yes', text: '' } },
    { ...stored, requestNote: 'x'.repeat(1001) },
  ]) {
    assert.equal(readCheckoutDraft(JSON.stringify(broken), cartKey, OWNER, NOW), null);
  }
});

test('다른 계정의 기록은 복원하지 않고 그 자리에서 지운다', () => {
  const storage = createStorage();
  const cartKey = checkoutDraftCartKey(items);
  saveCheckoutDraft(storage, draft, cartKey, OWNER, NOW);
  const raw = storage.getItem(CHECKOUT_DRAFT_STORAGE_KEY);

  assert.equal(JSON.parse(raw).ownerId, OWNER);
  assert.equal(readCheckoutDraft(raw, cartKey, 'user-b', NOW), null);
  assert.equal(loadCheckoutDraft(storage, cartKey, 'user-b', NOW), null);
  assert.equal(storage.values.has(CHECKOUT_DRAFT_STORAGE_KEY), false);
  // 지운 뒤에는 원래 계정으로 돌아와도 남은 것이 없다.
  assert.equal(loadCheckoutDraft(storage, cartKey, OWNER, NOW), null);
});

test('계정을 모르면 저장·복원하지 않고 남은 기록도 건드리지 않는다', () => {
  const storage = createStorage();
  const cartKey = checkoutDraftCartKey(items);
  saveCheckoutDraft(storage, draft, cartKey, '', NOW);
  assert.equal(storage.values.has(CHECKOUT_DRAFT_STORAGE_KEY), false);

  saveCheckoutDraft(storage, draft, cartKey, OWNER, NOW);
  const raw = storage.getItem(CHECKOUT_DRAFT_STORAGE_KEY);
  assert.equal(readCheckoutDraft(raw, cartKey, '', NOW), null);
  assert.equal(loadCheckoutDraft(storage, cartKey, '', NOW), null);
  assert.equal(storage.getItem(CHECKOUT_DRAFT_STORAGE_KEY), raw);
});

test('계정을 남기기 전 형식(버전 1) 기록은 누구 것인지 몰라 복원하지 않는다', () => {
  const storage = createStorage();
  const cartKey = checkoutDraftCartKey(items);
  storage.setItem(
    CHECKOUT_DRAFT_STORAGE_KEY,
    JSON.stringify({ version: 1, cartKey, savedAt: NOW, ...draft }),
  );
  assert.equal(loadCheckoutDraft(storage, cartKey, OWNER, NOW), null);
  assert.equal(storage.values.has(CHECKOUT_DRAFT_STORAGE_KEY), false);
});

test('다른 장바구니의 기록은 이 체크아웃이 덮어쓸 자리라 읽을 때 지운다', () => {
  const storage = createStorage();
  saveCheckoutDraft(storage, draft, checkoutDraftCartKey(items), OWNER, NOW);
  assert.equal(loadCheckoutDraft(storage, 'round-2:round-item-9', OWNER, NOW), null);
  assert.equal(storage.values.has(CHECKOUT_DRAFT_STORAGE_KEY), false);
});

test('모두 빈 입력은 남기지 않고 이전 기록도 지운다', () => {
  const storage = createStorage();
  const cartKey = checkoutDraftCartKey(items);
  saveCheckoutDraft(storage, draft, cartKey, OWNER, NOW);
  saveCheckoutDraft(
    storage,
    {
      address: { address: '', addressDetail: '', zipCode: '' },
      deliveryPhone: '',
      requestNote: '',
      packageLabel: { enabled: false, text: '' },
    },
    cartKey,
    OWNER,
    NOW,
  );
  assert.equal(storage.values.has(CHECKOUT_DRAFT_STORAGE_KEY), false);
});

test('결제가 성공하면 저장값을 지운다', () => {
  const storage = createStorage();
  const cartKey = checkoutDraftCartKey(items);
  saveCheckoutDraft(storage, draft, cartKey, OWNER, NOW);
  clearCheckoutDraft(storage);
  assert.equal(loadCheckoutDraft(storage, cartKey, OWNER, NOW), null);
});

test('저장소가 없거나 막혀도 예외 없이 넘어간다', () => {
  const cartKey = checkoutDraftCartKey(items);
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  assert.doesNotThrow(() => saveCheckoutDraft(blocked, draft, cartKey, OWNER, NOW));
  assert.equal(loadCheckoutDraft(blocked, cartKey, OWNER, NOW), null);
  assert.doesNotThrow(() => clearCheckoutDraft(blocked));
  assert.doesNotThrow(() => saveCheckoutDraft(null, draft, cartKey, OWNER, NOW));
  assert.equal(loadCheckoutDraft(null, cartKey, OWNER, NOW), null);
});

test('입력값은 탭 범위 저장소(sessionStorage)만 쓴다', () => {
  assert.match(source, /window\.sessionStorage/);
  assert.doesNotMatch(source, /localStorage/);
});
