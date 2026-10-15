import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIT_ACTION,
  countRefreshSessions,
  EXPECTED_PROJECT_ID,
  emailIdentityKey,
  maskEmail,
  run,
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
