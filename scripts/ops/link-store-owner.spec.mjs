import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUDIT_ACTION, EXPECTED_PROJECT_ID, run } from './link-store-owner.mjs';
import { uidFingerprint } from './lock-account.mjs';

const STORE = 'store-real-fixture-1';
const OLD_OWNER = 'deleted-owner-fixture';
const ADMIN = 'kakao-admin-fixture-1';
const SELLER = 'kakao-seller-fixture-2';
const EMAIL_ADMIN = 'owner.fixture@example.test';
const KEY_PATH = '/fixture/sa.json';
const NOW = Date.UTC(2026, 9, 15, 3, 4, 5, 678);

class FakeTimestamp {
  constructor(millis) {
    this.millis = millis;
  }
  static fromMillis(millis) {
    return new FakeTimestamp(millis);
  }
  toMillis() {
    return this.millis;
  }
  toDate() {
    return new Date(this.millis);
  }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value;
}

function createFakeDb(seed, { beforeCommit } = {}) {
  const docs = new Map(Object.entries(clone(seed)));
  const writes = [];

  const snapshot = (path) => {
    const exists = docs.has(path);
    return {
      id: path.split('/').pop(),
      exists,
      data: () => (exists ? clone(docs.get(path)) : undefined),
    };
  };

  const collectionDocs = (collectionPath) => {
    const depth = collectionPath.split('/').length + 1;
    return [...docs.keys()].filter(
      (p) => p.startsWith(`${collectionPath}/`) && p.split('/').length === depth,
    );
  };

  function query(collectionPath, filters = [], max = Infinity) {
    return {
      where: (field, op, value) => {
        assert.equal(op, '==');
        return query(collectionPath, [...filters, [field, value]], max);
      },
      limit: (n) => query(collectionPath, filters, n),
      get: async () => {
        const list = collectionDocs(collectionPath)
          .filter((p) => filters.every(([f, v]) => docs.get(p)?.[f] === v))
          .slice(0, max)
          .map(snapshot);
        return { docs: list, empty: list.length === 0, size: list.length };
      },
    };
  }

  const docRef = (path) => ({ path, get: async () => snapshot(path) });

  return {
    docs,
    writes,
    db: {
      doc: docRef,
      collection: (name) => query(name),
      runTransaction: async (fn) => {
        const pending = [];
        const tx = {
          get: async (ref) => snapshot(ref.path),
          update: (ref, data) => pending.push(['update', ref.path, data]),
          set: (ref, data) => pending.push(['set', ref.path, data]),
        };
        if (beforeCommit) beforeCommit(docs);
        await fn(tx);
        for (const [kind, path, data] of pending) {
          writes.push([kind, path]);
          if (kind === 'update') {
            if (!docs.has(path)) throw new Error(`NOT_FOUND ${path}`);
            docs.set(path, { ...docs.get(path), ...clone(data) });
          } else {
            docs.set(path, clone(data));
          }
        }
      },
    },
  };
}

function baseSeed(overrides = {}) {
  return {
    [`stores/${STORE}`]: { id: STORE, ownerId: OLD_OWNER, name: '실제 매장' },
    [`users/${ADMIN}`]: {
      id: ADMIN,
      email: EMAIL_ADMIN,
      role: 'admin',
      storeId: null,
      providers: ['kakao'],
      phone: '01012345678',
      createdAt: FakeTimestamp.fromMillis(Date.UTC(2026, 5, 1)),
    },
    [`users/${SELLER}`]: {
      id: SELLER,
      email: null,
      role: 'seller',
      storeId: null,
      providers: ['kakao'],
    },
    'users/email-admin': { id: 'email-admin', role: 'admin', providers: ['email'] },
    'users/consumer-k': { id: 'consumer-k', role: 'consumer', providers: ['kakao'] },
    [`refreshTokens/${ADMIN}`]: { updatedAt: FakeTimestamp.fromMillis(NOW) },
    ...overrides,
  };
}

// detail: true면 로컬 --detail 실행을 흉내 낸다. 기본은 공개 Actions 로그와 같은 기본 출력이다.
function harness({ seed = baseSeed(), env = {}, project, beforeCommit, detail = false } = {}) {
  const fake = createFakeDb(seed, { beforeCommit });
  const lines = [];
  const options = {
    argv: detail ? ['--detail'] : [],
    env: {
      LINK_STORE_ID: STORE,
      LINK_MODE: 'check',
      GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
      ...env,
    },
    write: (line) => lines.push(line),
    loadFile: async (path) => {
      assert.equal(path, KEY_PATH);
      return JSON.stringify({ project_id: project ?? EXPECTED_PROJECT_ID, private_key: 'fixture' });
    },
    connect: async () => ({ db: fake.db, Timestamp: FakeTimestamp }),
    now: () => NOW,
  };
  return { fake, lines, run: () => run(options), output: () => lines.join('\n') };
}

const link = (fingerprint, extra = {}) => ({
  LINK_MODE: 'link',
  LINK_TARGET_FINGERPRINT: fingerprint,
  ...extra,
});
const audits = (h) =>
  [...h.fake.docs.entries()].filter(([p]) => p.startsWith('auditLogs/')).map(([, d]) => d);

// 기본 출력(공개 로그)에 나오면 안 되는 상세 항목 이름.
const DETAIL_KEYS = [
  'storeIdPrefix',
  'storeName',
  'storeOwnerIdPrefix',
  'storeOwnerFingerprint',
  'storeUser:',
  'fingerprint:',
  'targetFingerprint',
  'uidPrefix',
  'storedEmail',
  'createdAt',
  'lastRefreshAt',
  'linkedStoreName',
  'ownsStoreIdPrefixes',
  'previousOwnerIdPrefix',
  'auditLogIdPrefix',
  'candidate 1/',
];

function assertDefaultOutput(out) {
  for (const key of DETAIL_KEYS)
    assert.ok(!out.includes(key), `detail key in default output: ${key}`);
  for (const raw of [EMAIL_ADMIN, ADMIN, SELLER, OLD_OWNER, STORE, '실제 매장', '01012345678']) {
    assert.ok(!out.includes(raw), 'identifier in default output');
  }
  for (const uid of [ADMIN, SELLER, OLD_OWNER]) assert.ok(!out.includes(uidFingerprint(uid)));
  assert.ok(!out.includes('2026-'), 'timestamps in default output');
}

test('default check prints counts and booleans only, without the candidate list', async () => {
  const h = harness();
  assert.equal(await h.run(), 0);
  const out = h.output();
  assertDefaultOutput(out);
  for (const line of [
    'mode: check',
    'storeDoc: yes',
    'storeOwnerSet: yes',
    'storeOwnerUserDoc: no',
    'storeUsers: 0',
    'kakaoCandidates: 2',
  ]) {
    assert.ok(h.lines.includes(line), line);
  }
  assert.match(out, /로컬에서 --detail/);
  assert.deepEqual(h.fake.writes, []);
});

test('default check with a fingerprint prints only that candidate as categories', async () => {
  const h = harness({ env: { LINK_TARGET_FINGERPRINT: uidFingerprint(ADMIN) } });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assertDefaultOutput(out);
  for (const line of [
    'targetCandidates: 1',
    'target role: admin',
    'target providers: kakao',
    'target suspended: no',
    'target phoneSet: yes',
    'target storeLinked: no',
    'target ownsStores: 0',
  ]) {
    assert.ok(h.lines.includes(line), line);
  }
  assert.ok(!out.includes('role: seller'), 'other candidates are not listed');
  assert.deepEqual(h.fake.writes, []);
});

test('check --detail lists the store and kakao admin/seller candidates without writing', async () => {
  const h = harness({ detail: true });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assert.match(out, /storeName: 실제 매장/);
  assert.match(out, /storeOwnerUserDoc: no/);
  assert.match(out, /storeUsers: 0/);
  assert.match(out, /kakaoCandidates: 2/);
  assert.match(out, new RegExp(`fingerprint: ${uidFingerprint(ADMIN)}`));
  assert.match(out, new RegExp(`fingerprint: ${uidFingerprint(SELLER)}`));
  assert.match(out, /role: admin/);
  assert.match(out, /storedEmail: o\*\*\*@e\*\*\*\.test/);
  assert.match(out, /lastRefreshAt: 2026-10-15T03:04:05\.678Z/);
  assert.match(out, /phoneSet: yes/);
  assert.match(out, /phoneSet: no/);
  assert.ok(!out.includes('01012345678'));
  // 이메일·uid 원문, 이메일 관리자·카카오 소비자는 나오지 않는다.
  for (const raw of [EMAIL_ADMIN, ADMIN, SELLER, OLD_OWNER, STORE]) assert.ok(!out.includes(raw));
  assert.ok(!out.includes(uidFingerprint('email-admin')));
  assert.ok(!out.includes(uidFingerprint('consumer-k')));
  assert.deepEqual(h.fake.writes, []);
});

test('link connects an admin to an orphan store, keeps the role, and writes an audit log', async () => {
  const h = harness({ env: link(uidFingerprint(ADMIN)) });
  assert.equal(await h.run(), 0);
  assert.equal(h.fake.docs.get(`stores/${STORE}`).ownerId, ADMIN);
  const user = h.fake.docs.get(`users/${ADMIN}`);
  assert.equal(user.storeId, STORE);
  assert.equal(user.role, 'admin');
  const [audit] = audits(h);
  assert.equal(audit.action, AUDIT_ACTION);
  assert.equal(audit.userId, ADMIN);
  assert.equal(audit.detail.previousOwnerId, OLD_OWNER);
  assert.equal(audit.detail.storeId, STORE);
  assert.match(h.output(), /linked: yes/);
  assert.match(h.output(), /^auditLogged: yes$/m);
  assert.ok(!h.output().includes(ADMIN));
  assertDefaultOutput(h.output());

  // 다시 실행해도 같은 결과(추가 쓰기 없음).
  const again = harness({
    seed: Object.fromEntries(h.fake.docs),
    env: link(uidFingerprint(ADMIN)),
  });
  assert.equal(await again.run(), 0);
  assert.match(again.output(), /alreadyLinked: yes/);
  assert.deepEqual(again.fake.writes, []);
});

test('link requires a fingerprint that matches exactly one kakao candidate', async () => {
  const missing = harness({ env: { LINK_MODE: 'link' } });
  assert.equal(await missing.run(), 1);
  assert.match(missing.output(), /LINK_TARGET_FINGERPRINT가 필요합니다/);

  for (const uid of ['email-admin', 'consumer-k', 'nobody']) {
    const h = harness({ env: link(uidFingerprint(uid)) });
    assert.equal(await h.run(), 1, uid);
    assert.match(h.output(), /일치하는 후보가 0개/);
    assert.deepEqual(h.fake.writes, []);
  }
});

test('link refuses to move a store owned by an active account', async () => {
  const seed = baseSeed({
    [`users/${OLD_OWNER}`]: { id: OLD_OWNER, role: 'seller', storeId: STORE, providers: ['email'] },
  });
  const h = harness({ seed, env: link(uidFingerprint(ADMIN)) });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /blocked: 현재 매장 owner가 정지되지 않은 기존 계정/);
  assert.match(h.output(), /blocked: 대상 외에 이 매장에 연결된 활성 사용자가 1명 있습니다/);
  // 막힌 이유의 식별값(fingerprint)은 --detail에서만 낸다.
  assertDefaultOutput(h.output());
  assert.deepEqual(h.fake.writes, []);

  const detailed = harness({ seed, env: link(uidFingerprint(ADMIN)), detail: true });
  assert.equal(await detailed.run(), 1);
  assert.match(detailed.output(), new RegExp(`fingerprints=${uidFingerprint(OLD_OWNER)}`));
  assert.deepEqual(detailed.fake.writes, []);
});

test('link allows replacing a suspended owner', async () => {
  const seed = baseSeed({
    [`users/${OLD_OWNER}`]: {
      id: OLD_OWNER,
      role: 'seller',
      storeId: STORE,
      providers: ['email'],
      suspended: true,
    },
  });
  const h = harness({ seed, env: link(uidFingerprint(SELLER)) });
  assert.equal(await h.run(), 0);
  assert.equal(h.fake.docs.get(`stores/${STORE}`).ownerId, SELLER);
  // 이전 owner 문서는 그대로 둔다.
  assert.equal(h.fake.docs.get(`users/${OLD_OWNER}`).storeId, STORE);
});

test('link refuses a target already linked to or owning another store', async () => {
  const linked = harness({
    seed: baseSeed({
      [`users/${ADMIN}`]: { id: ADMIN, role: 'admin', storeId: 'other', providers: ['kakao'] },
    }),
    env: link(uidFingerprint(ADMIN)),
  });
  assert.equal(await linked.run(), 1);
  assert.match(linked.output(), /이미 다른 매장/);

  const owning = harness({
    seed: baseSeed({ 'stores/other': { id: 'other', ownerId: ADMIN } }),
    env: link(uidFingerprint(ADMIN)),
  });
  assert.equal(await owning.run(), 1);
  assert.match(owning.output(), /소유한 다른 매장/);
  assert.deepEqual(owning.fake.writes, []);
});

test('link refuses a suspended target', async () => {
  const h = harness({
    seed: baseSeed({
      [`users/${ADMIN}`]: { id: ADMIN, role: 'admin', providers: ['kakao'], suspended: true },
    }),
    env: link(uidFingerprint(ADMIN)),
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /정지 상태/);
  assert.deepEqual(h.fake.writes, []);
});

test('link writes nothing when the store owner changes after the check', async () => {
  const h = harness({
    env: link(uidFingerprint(ADMIN)),
    beforeCommit: (docs) => {
      docs.set(`stores/${STORE}`, { ...docs.get(`stores/${STORE}`), ownerId: 'someone-else' });
    },
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /바뀌어 아무것도 바꾸지 않습니다/);
  assert.deepEqual(h.fake.writes, []);
});

test('rejects non-production keys, missing stores, and bad inputs', async () => {
  const wrong = harness({ project: 'other-project' });
  assert.equal(await wrong.run(), 1);
  assert.match(wrong.output(), /운영\(green-e4fe3\)이 아니어서 거부/);

  const none = harness({ env: { LINK_STORE_ID: 'missing-store' } });
  assert.equal(await none.run(), 0);
  assert.match(none.output(), /storeDoc: no/);
  const noneLink = harness({ env: { LINK_STORE_ID: 'missing-store', ...link('0123456789') } });
  assert.equal(await noneLink.run(), 1);

  const badId = harness({ env: { LINK_STORE_ID: 'a/b' } });
  assert.equal(await badId.run(), 1);
  const badFp = harness({ env: link('xyz') });
  assert.equal(await badFp.run(), 1);
});

test('--detail is refused in Actions/CI before connecting', async () => {
  for (const ciEnv of [{ GITHUB_ACTIONS: 'true' }, { CI: 'true' }]) {
    const h = harness({ detail: true, env: ciEnv });
    assert.equal(await h.run(), 1);
    assert.match(h.output(), /로컬 실행에서만/);
    assert.ok(!h.output().includes('storeDoc'));
    assert.deepEqual(h.fake.writes, []);
  }
});

test('unexpected errors print only a code and a sanitized message by default', async () => {
  const fail = () => {
    const error = new Error(
      `10 ABORTED: Transaction lock timeout on documents/stores/${STORE} for users/${ADMIN} (${EMAIL_ADMIN})`,
    );
    error.code = 10;
    return error;
  };
  const h = harness({ env: link(uidFingerprint(ADMIN)) });
  h.fake.db.runTransaction = async () => {
    throw fail();
  };
  assert.equal(await h.run(), 1);
  const out = h.output();
  assert.match(
    out,
    /^실패: 10 10 ABORTED: Transaction lock timeout on documents\/\[path\] for users\/\[path\] \(\[email\]\)$/m,
  );
  for (const raw of [STORE, ADMIN, EMAIL_ADMIN]) assert.ok(!out.includes(raw), raw);
  assert.deepEqual(h.fake.writes, []);
});
