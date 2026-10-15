import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  AUDIT_ACTION,
  countRefreshSessions,
  EXPECTED_PROJECT_ID,
  emailIdentityKey,
  idPrefix,
  maskEmail,
  run,
  uidFingerprint,
} from './lock-account.mjs';

const EMAIL = 'seller.fixture@example.test';
const MASKED = 's***@e***.test';
const UID = 'user-fixture-1';
const STORE = 'store-fixture-1';
const OLD_HASH = '$2b$12$fixtureOldHashValueForSpecOnly0000000000000000000000';
const KEY_PATH = '/fixture/sa.json';
const NOW = Date.UTC(2026, 9, 15, 3, 4, 5, 678);

// ── in-memory Firestore/Auth fake ─────────────────────────────────────────────

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

// Timestamp 같은 클래스 인스턴스는 그대로 두고 일반 객체·배열만 복사한다.
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value;
}

function createFakeDb(seed) {
  const docs = new Map(Object.entries(clone(seed)));
  const writes = [];

  const snapshot = (path) => {
    const exists = docs.has(path);
    return {
      id: path.split('/').pop(),
      exists,
      ref: docRef(path),
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
    const matches = () =>
      collectionDocs(collectionPath)
        .filter((p) => filters.every(([f, v]) => docs.get(p)?.[f] === v))
        .slice(0, max);
    return {
      where: (field, op, value) => {
        assert.equal(op, '==');
        return query(collectionPath, [...filters, [field, value]], max);
      },
      limit: (n) => query(collectionPath, filters, n),
      get: async () => {
        const list = matches().map(snapshot);
        return { docs: list, empty: list.length === 0, size: list.length };
      },
      count: () => ({ get: async () => ({ data: () => ({ count: matches().length }) }) }),
    };
  }

  function docRef(path) {
    return {
      path,
      get: async () => snapshot(path),
      set: async (data) => {
        writes.push(['set', path]);
        docs.set(path, clone(data));
      },
      update: async (data) => {
        writes.push(['update', path]);
        if (!docs.has(path)) throw new Error(`NOT_FOUND ${path}`);
        docs.set(path, { ...docs.get(path), ...clone(data) });
      },
      delete: async () => {
        writes.push(['delete', path]);
        docs.delete(path);
      },
      collection: (name) => query(`${path}/${name}`),
    };
  }

  return {
    docs,
    writes,
    db: {
      doc: docRef,
      collection: (name) => query(name),
      recursiveDelete: async (ref) => {
        writes.push(['recursiveDelete', ref.path]);
        for (const p of [...docs.keys()]) {
          if (p === ref.path || p.startsWith(`${ref.path}/`)) docs.delete(p);
        }
      },
    },
  };
}

function createFakeAuth(users = {}) {
  const state = structuredClone(users);
  const calls = [];
  return {
    state,
    calls,
    auth: {
      getUser: async (uid) => {
        if (!state[uid]) {
          const error = new Error('no user');
          error.code = 'auth/user-not-found';
          throw error;
        }
        return structuredClone(state[uid]);
      },
      revokeRefreshTokens: async (uid) => {
        calls.push(['revokeRefreshTokens', uid]);
        state[uid].tokensValidAfterTime = new Date(NOW).toUTCString();
      },
      updateUser: async (uid, patch) => {
        calls.push(['updateUser', uid, patch]);
        Object.assign(state[uid], patch);
      },
    },
  };
}

function baseSeed(overrides = {}) {
  return {
    [`users/${UID}`]: {
      id: UID,
      email: EMAIL,
      role: 'seller',
      storeId: STORE,
      providers: ['email'],
      passwordHash: OLD_HASH,
      createdAt: FakeTimestamp.fromMillis(Date.UTC(2026, 4, 5)),
    },
    [`emailIdentities/${emailIdentityKey(EMAIL)}`]: { userId: UID, email: EMAIL },
    [`refreshTokens/${UID}`]: { token: 'a'.repeat(64), updatedAt: FakeTimestamp.fromMillis(NOW) },
    [`stores/${STORE}`]: { id: STORE, ownerId: UID, isActive: true },
    'orders/o1': { storeId: STORE },
    'orders/o2': { storeId: STORE },
    'orders/o3': { storeId: 'other-store' },
    'products/p1': { storeId: STORE },
    ...overrides,
  };
}

const AUTH_USERS = {
  [UID]: {
    uid: UID,
    disabled: false,
    metadata: { lastSignInTime: 'Sat, 06 Jun 2026 01:02:03 GMT', creationTime: 'x' },
  },
};

function harness({ seed = baseSeed(), authUsers = AUTH_USERS, env = {}, project } = {}) {
  const fake = createFakeDb(seed);
  const fakeAuth = createFakeAuth(authUsers);
  const lines = [];
  const generated = [];
  let connected = 0;
  const options = {
    env: {
      LOCK_EMAIL: EMAIL,
      LOCK_MODE: 'check',
      GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
      ...env,
    },
    write: (line) => lines.push(line),
    loadFile: async (path) => {
      assert.equal(path, KEY_PATH);
      return JSON.stringify({ project_id: project ?? EXPECTED_PROJECT_ID, private_key: 'fixture' });
    },
    connect: async () => {
      connected += 1;
      return { db: fake.db, auth: fakeAuth.auth, Timestamp: FakeTimestamp };
    },
    hashPassword: async (plain) => {
      generated.push(plain);
      return `$2b$12$fixture-new-hash-${generated.length}`;
    },
    now: () => NOW,
  };
  return {
    fake,
    fakeAuth,
    lines,
    generated,
    connected: () => connected,
    run: () => run(options),
    output: () => lines.join('\n'),
  };
}

const userDoc = (h) => h.fake.docs.get(`users/${UID}`);
const auditDocs = (h) =>
  [...h.fake.docs.entries()].filter(([p]) => p.startsWith('auditLogs/')).map(([, d]) => d);

// ── tests ─────────────────────────────────────────────────────────────────────

test('maskEmail keeps only the first characters', () => {
  assert.equal(maskEmail('test@domain.com'), 't***@d***.com');
  assert.equal(maskEmail(EMAIL), MASKED);
  assert.equal(maskEmail('a@b'), 'a***@b***');
  assert.equal(maskEmail('nope'), '***');
});

test('check prints facts only and never the full email or the hash', async () => {
  const h = harness();
  assert.equal(await h.run(), 0);
  const out = h.output();
  assert.ok(!out.toLowerCase().includes(EMAIL.toLowerCase()));
  assert.ok(!out.includes(OLD_HASH));
  assert.ok(!out.includes('$2b$'));
  assert.ok(!out.includes(UID));
  assert.match(out, new RegExp(`email: ${MASKED.replace(/[.*]/g, '\\$&')}`));
  assert.match(out, /found: yes/);
  assert.match(out, /role: seller/);
  assert.match(out, /storeLinked: yes/);
  assert.match(out, /createdAt: 2026-05-05T00:00:00\.000Z/);
  assert.match(out, /lastLogin: 2026-06-06T01:02:03\.000Z/);
  assert.match(out, /alreadyLocked: no/);
  assert.match(out, /activeRefreshSessions: 1/);
  assert.match(out, /storeOrders: 2/);
  assert.match(out, /storeProducts: 1/);
  // check는 아무것도 쓰지 않는다.
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fakeAuth.calls, []);
});

test('lock replaces the hash, revokes sessions incl. subcollection, disables Firebase Auth', async () => {
  const seed = baseSeed({
    [`refreshTokens/${UID}/sessions/s1`]: { token: 'b'.repeat(64) },
    [`refreshTokens/${UID}/sessions/s2`]: { token: 'c'.repeat(64) },
  });
  const h = harness({ seed, env: { LOCK_MODE: 'lock' } });
  assert.equal(await h.run(), 0);

  const user = userDoc(h);
  assert.notEqual(user.passwordHash, OLD_HASH);
  assert.equal(user.passwordHash, '$2b$12$fixture-new-hash-1');
  assert.equal(user.suspended, true);
  assert.equal(user.sessionsRevokedAt.toMillis(), Math.floor(NOW / 1000) * 1000);
  assert.deepEqual(user.activeSessionIds, []);
  // 무작위 값은 32바이트(base64url 43자)이고 출력에 나오지 않는다.
  assert.equal(h.generated.length, 1);
  assert.equal(Buffer.from(h.generated[0], 'base64url').length, 32);

  const remaining = [...h.fake.docs.keys()].filter((p) => p.startsWith(`refreshTokens/${UID}`));
  assert.deepEqual(remaining, []);

  assert.deepEqual(h.fakeAuth.calls, [
    ['revokeRefreshTokens', UID],
    ['updateUser', UID, { disabled: true }],
  ]);
  assert.equal(h.fakeAuth.state[UID].disabled, true);

  // 사용자·매장·주문·상품은 지우지 않는다.
  for (const p of [`users/${UID}`, `stores/${STORE}`, 'orders/o1', 'orders/o2', 'products/p1']) {
    assert.ok(h.fake.docs.has(p), p);
  }
  assert.equal(user.email, EMAIL);
  assert.equal(user.storeId, STORE);

  const audits = auditDocs(h);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, AUDIT_ACTION);
  assert.equal(audits[0].userId, UID);
  assert.ok(!JSON.stringify(audits[0]).includes(EMAIL));

  const out = h.output();
  assert.match(out, /activeRefreshSessions: 3/);
  assert.match(out, /locked: yes/);
  assert.match(out, /activeRefreshSessionsAfter: 0/);
  assert.ok(!out.includes(EMAIL));
  assert.ok(!out.includes(h.generated[0]));
  assert.ok(!out.includes('$2b$'));
});

test('lock handles the per-device sessions map and activeSessionIds layout', async () => {
  const seed = baseSeed({
    [`refreshTokens/${UID}`]: {
      sessions: {
        sidA: { token: 'd'.repeat(64), createdAt: NOW - 1000 },
        sidB: { token: 'e'.repeat(64), createdAt: NOW - 500 },
      },
      updatedAt: FakeTimestamp.fromMillis(NOW),
    },
  });
  seed[`users/${UID}`].activeSessionIds = ['sidA', 'sidB'];

  const check = harness({ seed });
  assert.equal(await check.run(), 0);
  assert.match(check.output(), /activeRefreshSessions: 2/);

  const h = harness({ seed, env: { LOCK_MODE: 'lock' } });
  assert.equal(await h.run(), 0);
  assert.ok(!h.fake.docs.has(`refreshTokens/${UID}`));
  assert.deepEqual(userDoc(h).activeSessionIds, []);
  assert.ok(userDoc(h).sessionsRevokedAt);
  assert.match(h.output(), /activeRefreshSessionsAfter: 0/);
});

test('countRefreshSessions covers each layout', () => {
  assert.equal(countRefreshSessions({ refreshData: null, subcollectionSize: 0 }), 0);
  assert.equal(countRefreshSessions({ refreshData: { token: 'x' }, subcollectionSize: 0 }), 1);
  assert.equal(
    countRefreshSessions({ refreshData: { sessions: { a: {}, b: {} } }, subcollectionSize: 0 }),
    2,
  );
  assert.equal(countRefreshSessions({ refreshData: null, subcollectionSize: 3 }), 3);
  assert.equal(
    countRefreshSessions({ refreshData: null, subcollectionSize: 0, activeSessionIds: ['a'] }),
    1,
  );
});

test('lock is idempotent and the second check reports alreadyLocked', async () => {
  const h = harness({ env: { LOCK_MODE: 'lock' } });
  assert.equal(await h.run(), 0);
  const firstHash = userDoc(h).passwordHash;
  assert.equal(await h.run(), 0);

  const user = userDoc(h);
  assert.equal(user.suspended, true);
  assert.notEqual(user.passwordHash, OLD_HASH);
  assert.notEqual(user.passwordHash, firstHash);
  assert.deepEqual(user.activeSessionIds, []);
  assert.ok(!h.fake.docs.has(`refreshTokens/${UID}`));
  assert.equal(h.fakeAuth.state[UID].disabled, true);
  // 이미 disabled면 updateUser를 다시 부르지 않는다.
  assert.equal(h.fakeAuth.calls.filter(([name]) => name === 'updateUser').length, 1);
  assert.match(h.lines.join('\n').split('locked: yes')[1], /alreadyLocked: yes/);
  assert.equal(auditDocs(h).length, 2);
  for (const p of [`users/${UID}`, `stores/${STORE}`, 'orders/o1', 'products/p1']) {
    assert.ok(h.fake.docs.has(p), p);
  }
});

test('lock without a Firebase Auth user still locks the API account', async () => {
  const h = harness({ authUsers: {}, env: { LOCK_MODE: 'lock' } });
  assert.equal(await h.run(), 0);
  assert.equal(userDoc(h).suspended, true);
  assert.deepEqual(h.fakeAuth.calls, []);
  assert.match(h.output(), /firebaseAuthUser: no/);
  assert.equal(auditDocs(h)[0].detail.firebaseAuthDisabled, false);
});

test('finds the account by normalized email', async () => {
  const h = harness({ env: { LOCK_EMAIL: `  ${EMAIL.toUpperCase()} ` } });
  assert.equal(await h.run(), 0);
  assert.match(h.output(), /found: yes/);
  assert.ok(!h.output().toLowerCase().includes(EMAIL.toLowerCase()));
});

test('not found exits 0 and changes nothing', async () => {
  const h = harness({ env: { LOCK_EMAIL: 'nobody@example.test', LOCK_MODE: 'lock' } });
  assert.equal(await h.run(), 0);
  assert.match(h.output(), /not found/);
  assert.ok(!h.output().includes('nobody@example.test'));
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fakeAuth.calls, []);
});

test('role mismatch aborts before any write', async () => {
  const h = harness({ env: { LOCK_MODE: 'lock', LOCK_EXPECTED_ROLE: 'consumer' } });
  assert.equal(await h.run(), 1);
  assert.equal(userDoc(h).passwordHash, OLD_HASH);
  assert.ok(h.fake.docs.has(`refreshTokens/${UID}`));
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fakeAuth.calls, []);
  assert.equal(h.generated.length, 0);
});

test('matching expected role proceeds', async () => {
  const h = harness({ env: { LOCK_MODE: 'lock', LOCK_EXPECTED_ROLE: 'seller' } });
  assert.equal(await h.run(), 0);
  assert.equal(userDoc(h).suspended, true);
});

test('wrong project aborts before connecting', async () => {
  const h = harness({ project: 'greenhub-staging', env: { LOCK_MODE: 'lock' } });
  assert.equal(await h.run(), 1);
  assert.equal(h.connected(), 0);
  assert.match(h.output(), /거부/);
  assert.deepEqual(h.fake.writes, []);
});

test('missing credentials or invalid mode abort before connecting', async () => {
  const noKey = harness({ env: { GOOGLE_APPLICATION_CREDENTIALS: '' } });
  assert.equal(await noKey.run(), 1);
  assert.equal(noKey.connected(), 0);

  const badMode = harness({ env: { LOCK_MODE: 'delete' } });
  assert.equal(await badMode.run(), 1);
  assert.equal(badMode.connected(), 0);
});

test('two different accounts for one email abort', async () => {
  const seed = baseSeed({
    'users/other': { id: 'other', email: EMAIL.toLowerCase(), role: 'consumer' },
  });
  seed[`users/${UID}`].email = EMAIL.toUpperCase();
  const h = harness({ seed, env: { LOCK_EMAIL: EMAIL.toUpperCase(), LOCK_MODE: 'lock' } });
  assert.equal(await h.run(), 1);
  assert.deepEqual(h.fake.writes, []);
});

// ── 같은 이메일로 계정이 여럿인 경우 ─────────────────────────────────────────

const MIXED_EMAIL = 'Seller.Fixture@example.test';
const OTHER_UID = 'user-fixture-other-2';
const LINKED_UID = 'user-fixture-linked-3';
const LINKED_EMAIL = 'legacy.fixture@example.test';
const LINKED_STORE = 'store-fixture-linked';
const fp = (uid) => createHash('sha256').update(uid, 'utf8').digest('hex').slice(0, 10);

// exact(UID, 입력 그대로), normalized(OTHER_UID, 소문자), emailIdentities(LINKED_UID, 다른 이메일) 세 계정.
function multiSeed() {
  const seed = baseSeed({
    [`users/${OTHER_UID}`]: {
      id: OTHER_UID,
      email: EMAIL,
      role: 'consumer',
      passwordHash: OLD_HASH,
      createdAt: FakeTimestamp.fromMillis(Date.UTC(2026, 6, 1)),
    },
    [`refreshTokens/${OTHER_UID}`]: { token: 'f'.repeat(64) },
    [`users/${LINKED_UID}`]: {
      id: LINKED_UID,
      email: LINKED_EMAIL,
      role: 'seller',
      storeId: LINKED_STORE,
      suspended: true,
      passwordHash: OLD_HASH,
      createdAt: FakeTimestamp.fromMillis(Date.UTC(2025, 11, 24)),
    },
    [`emailIdentities/${emailIdentityKey(EMAIL)}`]: { userId: LINKED_UID, email: EMAIL },
    'orders/o9': { storeId: LINKED_STORE },
  });
  seed[`users/${UID}`].email = MIXED_EMAIL;
  return seed;
}

const MULTI_AUTH = {
  ...AUTH_USERS,
  [OTHER_UID]: { uid: OTHER_UID, disabled: false, metadata: {} },
};

function multiHarness(env = {}) {
  return harness({
    seed: multiSeed(),
    authUsers: MULTI_AUTH,
    env: { LOCK_EMAIL: MIXED_EMAIL, ...env },
  });
}

function assertNoIdentifiers(out) {
  const lower = out.toLowerCase();
  for (const value of [EMAIL, MIXED_EMAIL, LINKED_EMAIL]) {
    assert.ok(!lower.includes(value.toLowerCase()), 'full email in output');
  }
  for (const uid of [UID, OTHER_UID, LINKED_UID]) assert.ok(!out.includes(uid), 'uid in output');
  assert.ok(!out.includes('$2b$'));
}

function assertNothingWritten(h) {
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fakeAuth.calls, []);
  assert.equal(h.generated.length, 0);
  for (const uid of [UID, OTHER_UID, LINKED_UID]) {
    assert.equal(h.fake.docs.get(`users/${uid}`).passwordHash, OLD_HASH);
  }
}

// 출력에서 fingerprint로 그 계정 블록만 잘라낸다.
function candidateBlock(out, uid) {
  const blocks = out.split(/^candidate \d+\/\d+$/m).slice(1);
  const block = blocks.find((b) => b.includes(`fingerprint: ${fp(uid)}`));
  assert.ok(block, `block for ${fp(uid)}`);
  return block;
}

test('uidFingerprint is the first 10 hex chars of sha256(uid)', () => {
  assert.equal(uidFingerprint(UID), fp(UID));
  assert.match(uidFingerprint(UID), /^[0-9a-f]{10}$/);
});

test('multi-candidate check lists every candidate and writes nothing', async () => {
  const h = multiHarness({ LOCK_EXPECTED_ROLE: 'seller' });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assertNoIdentifiers(out);
  assertNothingWritten(h);
  assert.match(out, /candidates: 3/);
  assert.equal(out.match(/^candidate \d\/3$/gm).length, 3);

  const exact = candidateBlock(out, UID);
  assert.match(exact, /matchedBy: exact\n/);
  assert.match(exact, /storedEmail: S\*\*\*@e\*\*\*\.test/);
  assert.match(exact, /role: seller/);
  assert.match(exact, /suspended: no/);
  assert.match(exact, /alreadyLocked: no/);
  assert.match(exact, /storeLinked: yes/);
  assert.match(exact, /storeOrders: 2/);
  assert.match(exact, /storeProducts: 1/);
  assert.match(exact, /createdAt: 2026-05-05T00:00:00\.000Z/);
  assert.match(exact, /lastLogin: 2026-06-06T01:02:03\.000Z/);
  assert.match(exact, /activeRefreshSessions: 1/);
  assert.match(exact, /roleMatchesExpected: yes/);

  const normalized = candidateBlock(out, OTHER_UID);
  assert.match(normalized, /matchedBy: normalized\n/);
  assert.match(normalized, /role: consumer/);
  assert.match(normalized, /storeLinked: no/);
  assert.ok(!normalized.includes('storeOrders'));
  assert.match(normalized, /lastLogin: n\/a/);
  assert.match(normalized, /roleMatchesExpected: no/);

  const linked = candidateBlock(out, LINKED_UID);
  assert.match(linked, /matchedBy: emailIdentities\n/);
  assert.match(linked, /storedEmail: l\*\*\*@e\*\*\*\.test/);
  assert.match(linked, /suspended: yes/);
  assert.match(linked, /firebaseAuthUser: no/);
  assert.match(linked, /storeOrders: 1/);
  assert.match(linked, /storeProducts: 0/);
  assert.match(linked, /activeRefreshSessions: 0/);
});

test('multi-candidate lock without a fingerprint aborts before any write', async () => {
  const h = multiHarness({ LOCK_MODE: 'lock' });
  assert.equal(await h.run(), 1);
  assertNothingWritten(h);
  assert.match(h.output(), /target_fingerprint/);
  assertNoIdentifiers(h.output());
});

test('multi-candidate lock with a fingerprint locks only that account', async () => {
  const h = multiHarness({
    LOCK_MODE: 'lock',
    LOCK_EXPECTED_ROLE: 'consumer',
    LOCK_TARGET_FINGERPRINT: fp(OTHER_UID).toUpperCase(),
  });
  assert.equal(await h.run(), 0);

  const target = h.fake.docs.get(`users/${OTHER_UID}`);
  assert.equal(target.suspended, true);
  assert.notEqual(target.passwordHash, OLD_HASH);
  assert.ok(!h.fake.docs.has(`refreshTokens/${OTHER_UID}`));
  assert.equal(h.fakeAuth.state[OTHER_UID].disabled, true);

  // 다른 계정은 그대로다.
  for (const uid of [UID, LINKED_UID]) {
    assert.equal(h.fake.docs.get(`users/${uid}`).passwordHash, OLD_HASH);
  }
  assert.equal(userDoc(h).suspended, undefined);
  assert.ok(h.fake.docs.has(`refreshTokens/${UID}`));
  assert.equal(h.fakeAuth.state[UID].disabled, false);
  assert.ok(h.fakeAuth.calls.every(([, uid]) => uid === OTHER_UID));
  const userWrites = h.fake.writes.filter(([, p]) => p.startsWith('users/'));
  assert.deepEqual(userWrites, [['update', `users/${OTHER_UID}`]]);

  const audits = auditDocs(h);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].userId, OTHER_UID);
  assert.match(h.output(), /locked: yes/);
  assertNoIdentifiers(h.output());
});

test('a wrong or malformed fingerprint aborts before any write', async () => {
  const wrong = multiHarness({ LOCK_MODE: 'lock', LOCK_TARGET_FINGERPRINT: '0123456789' });
  assert.notEqual(fp(UID), '0123456789');
  assert.equal(await wrong.run(), 1);
  assert.match(wrong.output(), /일치하는 계정이 0개/);
  assertNothingWritten(wrong);

  const malformed = multiHarness({ LOCK_MODE: 'lock', LOCK_TARGET_FINGERPRINT: 'not-a-hash' });
  assert.equal(await malformed.run(), 1);
  assert.equal(malformed.connected(), 0);
  assertNothingWritten(malformed);
});

test('expected role still applies to the targeted account', async () => {
  const h = multiHarness({
    LOCK_MODE: 'lock',
    LOCK_EXPECTED_ROLE: 'seller',
    LOCK_TARGET_FINGERPRINT: fp(OTHER_UID),
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /role: consumer/);
  assertNothingWritten(h);
});

test('single-candidate lock requires a given fingerprint to match', async () => {
  const wrong = harness({ env: { LOCK_MODE: 'lock', LOCK_TARGET_FINGERPRINT: fp(OTHER_UID) } });
  assert.equal(await wrong.run(), 1);
  assert.deepEqual(wrong.fake.writes, []);
  assert.deepEqual(wrong.fakeAuth.calls, []);
  assert.equal(userDoc(wrong).passwordHash, OLD_HASH);

  const right = harness({ env: { LOCK_MODE: 'lock', LOCK_TARGET_FINGERPRINT: fp(UID) } });
  assert.equal(await right.run(), 0);
  assert.equal(userDoc(right).suspended, true);
  assert.match(right.output(), new RegExp(`fingerprint: ${fp(UID)}`));
});

test('error messages containing the raw email are masked', async () => {
  const h = harness({ env: { LOCK_MODE: 'lock' } });
  const original = h.fake.db.recursiveDelete;
  h.fake.db.recursiveDelete = async () => {
    throw new Error(`boom for ${EMAIL}`);
  };
  assert.equal(await h.run(), 1);
  assert.ok(!h.output().includes(EMAIL));
  assert.match(h.output(), new RegExp(MASKED.replace(/[.*]/g, '\\$&')));
  h.fake.db.recursiveDelete = original;
});

// ── check: 매장 정보 ────────────────────────────────────────────────────────

const STORE_NAME = '디어 오키드 픽스처';
const KAKAO_UID = 'kakao-fixture-seller-9';
const GONE_OWNER_UID = 'deleted-owner-fixture-7';

test('check prints uid prefix and store details when the user owns the store', async () => {
  const seed = baseSeed();
  seed[`stores/${STORE}`].name = STORE_NAME;
  const h = harness({ seed });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assert.match(out, new RegExp(`^uidPrefix: ${UID.slice(0, 8)}$`, 'm'));
  assert.match(out, new RegExp(`^storeIdPrefix: ${STORE.slice(0, 8)}$`, 'm'));
  assert.match(out, /^storeDoc: yes$/m);
  assert.match(out, new RegExp(`^storeName: ${STORE_NAME}$`, 'm'));
  assert.match(out, new RegExp(`^storeOwnerIdPrefix: ${UID.slice(0, 8)}$`, 'm'));
  assert.match(out, /^storeOwnerIsThisUser: yes$/m);
  assert.ok(!out.includes('storeOwnerUserDoc'));
  assert.match(out, /^storeSellerUsers: 1$/m);
  assert.match(
    out,
    new RegExp(
      `storeUser: uidPrefix=${UID.slice(0, 8)} fingerprint=${fp(UID)} role=seller providers=email suspended=no thisCandidate=yes storeOwner=yes`,
    ),
  );
  assert.ok(!out.includes(UID));
  assert.ok(!out.includes(STORE));
  assert.ok(!out.toLowerCase().includes(EMAIL.toLowerCase()));
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fakeAuth.calls, []);
});

test('check flags a store owned by another (deleted) user and lists other sellers on it', async () => {
  const seed = baseSeed({
    [`stores/${STORE}`]: { id: STORE, ownerId: GONE_OWNER_UID, name: STORE_NAME },
    [`users/${KAKAO_UID}`]: {
      id: KAKAO_UID,
      email: 'kakao.seller@example.test',
      role: 'seller',
      storeId: STORE,
      providers: ['kakao'],
      passwordHash: OLD_HASH,
    },
    'users/unrelated-seller-fixture': { id: 'x', role: 'seller', storeId: 'other-store' },
  });
  seed[`users/${UID}`].suspended = true;
  const h = harness({ seed });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assert.match(out, new RegExp(`^storeOwnerIdPrefix: ${GONE_OWNER_UID.slice(0, 8)}$`, 'm'));
  assert.match(out, /^storeOwnerIsThisUser: no$/m);
  assert.match(out, /^storeOwnerUserDoc: no$/m);
  assert.match(out, /^storeSellerUsers: 2$/m);
  assert.match(
    out,
    new RegExp(
      `storeUser: uidPrefix=${UID.slice(0, 8)} fingerprint=${fp(UID)} role=seller providers=email suspended=yes thisCandidate=yes storeOwner=no`,
    ),
  );
  assert.match(
    out,
    new RegExp(
      `storeUser: uidPrefix=${KAKAO_UID.slice(0, 8)} fingerprint=${fp(KAKAO_UID)} role=seller providers=kakao suspended=no thisCandidate=no storeOwner=no`,
    ),
  );
  assert.ok(!out.includes('unrelated'));
  for (const uid of [UID, KAKAO_UID, GONE_OWNER_UID])
    assert.ok(!out.includes(uid), 'uid in output');
  for (const email of [EMAIL, 'kakao.seller@example.test']) {
    assert.ok(!out.toLowerCase().includes(email), 'full email in output');
  }
  assert.ok(!out.includes('$2b$'));
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fakeAuth.calls, []);
});

test('multi-candidate check adds store details per candidate with a linked store', async () => {
  const seed = multiSeed();
  seed[`stores/${STORE}`].name = STORE_NAME;
  const h = harness({ seed, authUsers: MULTI_AUTH, env: { LOCK_EMAIL: MIXED_EMAIL } });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assertNoIdentifiers(out);
  assertNothingWritten(h);

  const exact = candidateBlock(out, UID);
  assert.match(exact, new RegExp(`uidPrefix: ${UID.slice(0, 8)}\n`));
  assert.match(exact, new RegExp(`storeName: ${STORE_NAME}\n`));
  assert.match(exact, /storeOwnerIsThisUser: yes/);
  assert.match(exact, /storeSellerUsers: 1\n/);

  const normalized = candidateBlock(out, OTHER_UID);
  assert.match(normalized, new RegExp(`uidPrefix: ${OTHER_UID.slice(0, 8)}\n`));
  assert.ok(!normalized.includes('storeIdPrefix'));
  assert.ok(!normalized.includes('storeSellerUsers'));

  // 매장 문서가 없는 연결도 읽기만 하고 사실대로 출력한다.
  const linked = candidateBlock(out, LINKED_UID);
  assert.match(linked, new RegExp(`storeIdPrefix: ${LINKED_STORE.slice(0, 8)}\n`));
  assert.match(linked, /storeDoc: no/);
  assert.ok(!linked.includes('storeName'));
  assert.match(linked, /storeSellerUsers: 1\n/);
  assert.match(linked, /thisCandidate=yes/);
});

test('store user listing is bounded to 20 docs', async () => {
  const extra = {};
  for (let i = 0; i < 25; i += 1) {
    extra[`users/bulk-seller-fixture-${String(i).padStart(2, '0')}`] = {
      role: 'seller',
      storeId: STORE,
      providers: ['kakao'],
    };
  }
  const h = harness({ seed: baseSeed(extra) });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assert.match(out, /^storeSellerUsers: 20\+ \(limit reached\)$/m);
  assert.equal(out.match(/storeUser: /g).length, 20);
  assert.deepEqual(h.fake.writes, []);
});

test('lock output is unchanged by store details', async () => {
  const h = harness({ env: { LOCK_MODE: 'lock' } });
  assert.equal(await h.run(), 0);
  const out = h.output();
  for (const key of ['uidPrefix', 'storeIdPrefix', 'storeName', 'storeOwner', 'storeSellerUsers']) {
    assert.ok(!out.includes(key), key);
  }
  assert.match(out, /locked: yes/);
});

test('idPrefix keeps only the first 8 characters', () => {
  assert.equal(idPrefix('7ec0e26b-aaaa-bbbb'), '7ec0e26b');
  assert.equal(idPrefix(''), 'n/a');
  assert.equal(idPrefix(undefined), 'n/a');
});
