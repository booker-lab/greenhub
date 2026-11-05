import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareParity,
  normalizeStorage,
  normalizeVolatile,
  parseParityAllowances,
} from './parity.mjs';

const record = (overrides = {}) => ({
  writes: [{ method: 'POST', path: '/stores/s/orders', query: '', body: '{"quantity":1}' }],
  portoneCalls: [{ totalAmount: 75000, channelKey: 'k' }],
  storage: { localStorage: { greenhub_cart: '[]' }, sessionStorage: {} },
  aria: '- link "홈":\n  - /url: /\n- button "결제하기"',
  ...overrides,
});

// 판매자 하네스가 남기는 Firebase 에뮬레이터 로그인 기록과 같은 모양(서명 없는 토큰, 실행마다 시각만 다름).
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const firebaseUser = ({ at, role = 'admin' }) =>
  JSON.stringify({
    uid: 'admin-visual-0001',
    emailVerified: false,
    isAnonymous: false,
    providerData: [],
    stsTokenManager: {
      refreshToken: 'eyJfQXV0aEVtdWxhdG9yUmVmcmVzaFRva2VuIjoiRE8gTk9UIE1PRElGWSJ9',
      accessToken: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ role, storeId: 'store-visual-0001', auth_time: at, user_id: 'admin-visual-0001', iat: at, exp: at + 3600, aud: 'greenhub-local' })}.`,
      expirationTime: 1793462400000,
    },
    createdAt: String(at * 1000 - 40000),
    lastLoginAt: String(at * 1000),
    apiKey: 'visual-harness-fake-key',
    appName: '[DEFAULT]',
  });
const FIREBASE_KEY = 'firebase:authUser:visual-harness-fake-key:[DEFAULT]';
const sellerStorage = (user, local = {}) => ({
  localStorage: local,
  sessionStorage: { [FIREBASE_KEY]: user },
});

describe('parity: 작업 전·후 동작·접근성 비교', () => {
  it('같은 기록은 같음, 결제마다 바뀌는 UUID·시각은 무시한다', () => {
    const a = record({
      writes: [
        {
          method: 'POST',
          path: '/o',
          query: '',
          body: '{"id":"3f0c2b8e-1d2a-4b5c-8d9e-0a1b2c3d4e5f","at":"2026-10-31T01:02:03.456Z"}',
        },
      ],
    });
    const b = record({
      writes: [
        {
          method: 'POST',
          path: '/o',
          query: '',
          body: '{"id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","at":"2026-10-31T09:09:09.000Z"}',
        },
      ],
    });
    const [result] = compareParity({ 'x@mobile': a }, { 'x@mobile': b });
    assert.equal(result.status, 'same');
    assert.equal(normalizeVolatile('2026-10-31T00:00:00+09:00'), '<time>');
  });

  it('판매자 Firebase 에뮬레이터 로그인 기록은 로그인·토큰 시각만 달라도 같음', () => {
    const a = record({ storage: sellerStorage(firebaseUser({ at: 1793495830 })) });
    const b = record({ storage: sellerStorage(firebaseUser({ at: 1793496282 })) });
    const [result] = compareParity({ 'x@mobile': a }, { 'x@mobile': b });
    assert.equal(result.status, 'same');
    const normalized = JSON.parse(normalizeStorage(a.storage).sessionStorage[FIREBASE_KEY]);
    assert.equal(normalized.lastLoginAt, '<time>');
    assert.match(normalized.stsTokenManager.accessToken, /"iat":"<time>"/);
    assert.match(normalized.stsTokenManager.accessToken, /"role":"admin"/);
  });

  it('로그인 기록의 시각이 아닌 값(토큰 클레임)이 다르면 차이로 잡는다', () => {
    const a = record({ storage: sellerStorage(firebaseUser({ at: 1793495830 })) });
    const b = record({ storage: sellerStorage(firebaseUser({ at: 1793496282, role: 'seller' })) });
    const [result] = compareParity({ 'x@mobile': a }, { 'x@mobile': b });
    assert.equal(result.status, 'different');
    assert.deepEqual(
      result.differences.map((d) => d.kind),
      ['storage'],
    );
  });

  it('로그인 기록 밖의 저장소 차이(상품 임시 저장 유무)는 그대로 잡는다', () => {
    const a = record({ storage: sellerStorage(firebaseUser({ at: 1793495830 })) });
    const b = record({
      storage: sellerStorage(firebaseUser({ at: 1793496282 }), {
        product_draft_new: '{"name":"x"}',
      }),
    });
    const [result] = compareParity({ 'x@mobile': a }, { 'x@mobile': b });
    assert.equal(result.status, 'different');
    assert.deepEqual(
      result.differences.map((d) => d.kind),
      ['storage'],
    );
  });

  it('주문 요청 본문의 값 하나가 달라도 차이로 잡는다', () => {
    const b = record({
      writes: [{ method: 'POST', path: '/stores/s/orders', query: '', body: '{"quantity":2}' }],
    });
    const [result] = compareParity({ 'x@mobile': record() }, { 'x@mobile': b });
    assert.equal(result.status, 'different');
    assert.deepEqual(
      result.differences.map((d) => d.kind),
      ['writes'],
    );
  });

  it('결제창 인자·저장소 차이를 잡는다', () => {
    const b = record({
      portoneCalls: [{ totalAmount: 75001, channelKey: 'k' }],
      storage: { localStorage: { greenhub_cart: '[1]' }, sessionStorage: {} },
    });
    const [result] = compareParity({ 'x@mobile': record() }, { 'x@mobile': b });
    assert.deepEqual(
      result.differences.map((d) => d.kind),
      ['portoneCalls', 'storage'],
    );
  });

  it('링크가 버튼이 되면(역할 변화) 접근성 차이로 잡는다', () => {
    const b = record({ aria: '- button "홈"\n- button "결제하기"' });
    const [result] = compareParity({ 'x@mobile': record() }, { 'x@mobile': b });
    assert.equal(result.status, 'different');
    assert.deepEqual(
      result.differences.map((d) => d.kind),
      ['aria'],
    );
  });

  it('한쪽에만 결제창 기록이 있거나 화면이 없으면 실패다', () => {
    const [onlyBefore] = compareParity(
      { 'x@mobile': record() },
      { 'x@mobile': record({ portoneCalls: undefined }) },
    );
    assert.equal(onlyBefore.status, 'different');
    const [missing] = compareParity({ 'x@mobile': record() }, {});
    assert.equal(missing.status, 'missing');
  });

  it('허용 목록은 사유가 있어야 하고, 그 화면·종류의 차이만 허용한다', () => {
    assert.throws(() => parseParityAllowances([{ screen: 'x', kind: 'aria' }]), /사유/);
    assert.throws(
      () => parseParityAllowances([{ screen: 'x', kind: 'pixels', reason: 'r' }]),
      /kind/,
    );
    const allow = parseParityAllowances([
      { screen: 'x', kind: 'aria', reason: 'Stepper를 ol로 바꿈' },
    ]);
    const b = record({ aria: '- list', writes: [] });
    const [result] = compareParity({ 'x@mobile': record() }, { 'x@mobile': b }, allow);
    assert.equal(result.status, 'different');
    assert.deepEqual(
      result.differences.map((d) => [d.kind, Boolean(d.allowed)]),
      [
        ['writes', false],
        ['aria', true],
      ],
    );
  });
  it('경로 안내를 뺀 묶음과 안 뺀 묶음은 aria가 같아도 비교하지 않고 실패로 본다', () => {
    const excluded = record({ ariaExcludes: ['next-route-announcer'] });
    const legacy = record({ ariaExcludes: [] });
    const [result] = compareParity({ 'x@mobile': legacy }, { 'x@mobile': excluded });
    assert.equal(result.status, 'different');
    assert.equal(result.differences[0].kind, 'aria');
    assert.match(result.differences[0].reason, /다른 방식으로 찍음/);
  });

  it('같은 방식으로 찍은 묶음은 앱이 그린 alert 차이를 그대로 잡는다', () => {
    const ariaExcludes = ['next-route-announcer'];
    const a = record({
      ariaExcludes,
      aria: '- button "결제하기"\n- alert: 결제 수단을 골라 주세요',
    });
    const b = record({ ariaExcludes, aria: '- button "결제하기"\n- alert' });
    const [result] = compareParity({ 'x@mobile': a }, { 'x@mobile': b });
    assert.equal(result.status, 'different');
    assert.equal(result.differences[0].kind, 'aria');
  });
});
