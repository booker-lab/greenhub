import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PRODUCTION_WRITE_FLAG } from '../production-write-guard.mjs';
import { emailIdentityKey, AUDIT_ACTION as LOCK_AUDIT_ACTION } from './lock-account.mjs';
import {
  classifyAccount,
  collectStrings,
  computePlanHash,
  DELETE_AUDIT_ACTION,
  lastAuthActivity,
  lastSessionActivity,
  parseArgs,
  parsePlan,
  RetireError,
  resolveAction,
  run,
} from './retire-test-accounts.mjs';

const NOW = Date.UTC(2026, 9, 18, 3, 4, 5, 678);
const KEY_PATH = '/fixture/sa.json';
const REPO = resolve('/fixture-repo');
const PLAN_PATH = resolve('/outside/plan.json');
const HASH = '$2b$12$fixtureHashValueForSpecOnly000000000000000000000000';
const NEW_HASH = '$2b$12$fixture-new-hash';

const U = {
  specConsumer: 'c0nsumer-fixture-uid-0001',
  specDriver: 'dr1ver00-fixture-uid-0002',
  specWithOrder: 'c0nsord0-fixture-uid-0003',
  admin: 'adm1n000-fixture-uid-0004',
  refSeller: 's3ller00-fixture-uid-0005',
  refConsumer: 'refcons1-fixture-uid-0006',
  kakao: 'kakao000-fixture-uid-0007',
  outsider: 'outsid3r-fixture-uid-0008',
};
const E = {
  specConsumer: 'consumer-sec-1700000000001@example.com',
  specDriver: 'driver-sec-1700000000002@example.com',
  specWithOrder: 'consumer-sec-1700000000003@example.com',
  admin: 'admin.fixture@test.com',
  refSeller: 'seller.fixture@test.com',
  refConsumer: 'consumer.fixture@test.com',
  kakao: 'real.person@kakao.example',
  outsider: 'someone@outside.example',
};

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
  // 문서 내용을 돌려준 경로(count 집계는 내용을 읽지 않으므로 넣지 않는다).
  const reads = new Set();

  const snapshot = (path) => {
    const exists = docs.has(path);
    if (exists) reads.add(path);
    return {
      id: path.split('/').pop(),
      exists,
      ref: docRef(path),
      data: () => (exists ? clone(docs.get(path)) : undefined),
    };
  };

  const collectionDocs = (collectionPath) => {
    const depth = collectionPath.split('/').length + 1;
    return [...docs.keys()]
      .filter((p) => p.startsWith(`${collectionPath}/`) && p.split('/').length === depth)
      .sort();
  };

  function query(collectionPath, filters = []) {
    const matches = () =>
      collectionDocs(collectionPath).filter((p) =>
        filters.every(([field, op, value]) => {
          const actual = docs.get(p)?.[field];
          if (op === '==') return actual === value;
          if (op === 'array-contains') return Array.isArray(actual) && actual.includes(value);
          throw new Error(`unsupported op ${op}`);
        }),
      );
    return {
      where: (field, op, value) => query(collectionPath, [...filters, [field, op, value]]),
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
    reads,
    db: {
      doc: docRef,
      collection: (name) => query(name),
      batch: () => {
        const ops = [];
        const batch = {
          delete: (ref) => {
            ops.push(['delete', ref.path]);
            return batch;
          },
          set: (ref, data) => {
            ops.push(['set', ref.path, clone(data)]);
            return batch;
          },
          commit: async () => {
            for (const [op, path, data] of ops) {
              writes.push([`batch.${op}`, path]);
              if (op === 'delete') docs.delete(path);
              else docs.set(path, data);
            }
          },
        };
        return batch;
      },
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
  const notFound = () => Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
  return {
    state,
    calls,
    auth: {
      getUsers: async (ids) => ({
        users: ids.filter(({ uid }) => state[uid]).map(({ uid }) => structuredClone(state[uid])),
        notFound: ids.filter(({ uid }) => !state[uid]),
      }),
      getUser: async (uid) => {
        if (!state[uid]) throw notFound();
        return structuredClone(state[uid]);
      },
      deleteUser: async (uid) => {
        calls.push(['deleteUser', uid]);
        if (!state[uid]) throw notFound();
        delete state[uid];
      },
      revokeRefreshTokens: async (uid) => {
        calls.push(['revokeRefreshTokens', uid]);
      },
      updateUser: async (uid, patch) => {
        calls.push(['updateUser', uid, patch]);
        Object.assign(state[uid], patch);
      },
    },
  };
}

function baseSeed(extra = {}) {
  const user = (key, fields) => ({
    [`users/${U[key]}`]: {
      id: U[key],
      email: E[key],
      providers: ['email'],
      passwordHash: HASH,
      createdAt: FakeTimestamp.fromMillis(Date.UTC(2026, 6, 1)),
      ...fields,
    },
  });
  return {
    ...user('specConsumer', { role: 'consumer' }),
    [`emailIdentities/${emailIdentityKey(E.specConsumer)}`]: { userId: U.specConsumer },
    ...user('specDriver', { role: 'driver', driverApproved: false }),
    [`emailIdentities/${emailIdentityKey(E.specDriver)}`]: { userId: U.specDriver },
    ...user('specWithOrder', { role: 'consumer' }),
    'orders/o1': { userId: U.specWithOrder, storeId: 'store-x' },
    ...user('admin', { role: 'admin', name: '테스트 어드민', phone: '010-0000-0001' }),
    [`refreshTokens/${U.admin}`]: { sessions: { s1: { tokenHash: 'a'.repeat(64) } } },
    [`refreshTokens/${U.admin}/sessions/s1`]: { tokenHash: 'b'.repeat(64) },
    'auditLogs/a1': { userId: U.admin, action: 'auth.login.failed' },
    ...user('refSeller', { role: 'seller', storeId: 'store-1', suspended: true }),
    'stores/store-1': { ownerId: U.refSeller },
    ...user('refConsumer', { role: 'consumer' }),
    [`users/${U.kakao}`]: {
      id: U.kakao,
      email: E.kakao,
      providers: ['kakao'],
      kakaoId: '123',
      role: 'consumer',
    },
    ...user('outsider', { role: 'consumer' }),
    ...extra,
  };
}

const AUTH = { [U.admin]: { uid: U.admin, disabled: false } };

function harness({ seed = baseSeed(), authUsers = AUTH, project = 'green-e4fe3', files } = {}) {
  const fake = createFakeDb(seed);
  const fakeAuth = createFakeAuth(authUsers);
  const saved = files ?? new Map();
  const lines = [];
  let connected = 0;
  const exec = (argv) =>
    run({
      argv,
      env: { GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH },
      write: (line) => lines.push(line),
      loadFile: async (path) => {
        if (path === KEY_PATH) return JSON.stringify({ project_id: project });
        if (saved.has(path)) return saved.get(path);
        throw new Error(`ENOENT ${path}`);
      },
      saveFile: async (path, text) => {
        saved.set(path, text);
      },
      connect: async () => {
        connected += 1;
        return { db: fake.db, auth: fakeAuth.auth, Timestamp: FakeTimestamp };
      },
      hashPassword: async () => NEW_HASH,
      now: () => NOW,
      repoRoot: REPO,
    });
  return {
    fake,
    fakeAuth,
    files: saved,
    run: exec,
    connected: () => connected,
    output: () => lines.join('\n'),
    reset: () => {
      lines.length = 0;
    },
    plan: () => JSON.parse(saved.get(PLAN_PATH)),
  };
}

async function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
}

function applyArgs(planHash, ...extra) {
  return ['apply', '--plan', PLAN_PATH, '--plan-hash', planHash, ...extra];
}

function assertNoRawIdentifiers(out) {
  for (const uid of Object.values(U)) assert.ok(!out.includes(uid), `uid 원문 노출: ${uid}`);
  for (const email of Object.values(E))
    assert.ok(!out.includes(email), `이메일 원문 노출: ${email}`);
  assert.ok(!out.includes('$2b$'), '비밀번호 해시 노출');
}

const entryTuples = (plan) => plan.entries.map((e) => [e.uid, e.category, e.action]);

// ── 순수 함수 ─────────────────────────────────────────────────────────────────

test('classifyAccount는 E2E 임시 계정·테스트 관리자만 처리 후보로 분류한다', () => {
  const base = { providers: ['email'], passwordHash: HASH };
  const cases = [
    [{ ...base, email: E.specConsumer, role: 'consumer' }, 'spec-temp'],
    [{ ...base, email: E.specDriver, role: 'driver' }, 'spec-temp'],
    [{ ...base, email: 'Consumer-Sec-1@Example.com ', role: 'consumer' }, 'spec-temp'],
    // 접두와 role이 다르거나, 매장·카카오가 연결돼 있으면 후보가 아니다.
    [{ ...base, email: E.specConsumer, role: 'driver' }, 'reference'],
    [{ ...base, email: E.specConsumer, role: 'consumer', storeId: 's1' }, 'reference'],
    [
      { ...base, email: E.specConsumer, role: 'consumer', providers: ['email', 'kakao'] },
      'reference',
    ],
    [{ ...base, email: E.specConsumer, role: 'consumer', kakaoId: '1' }, 'reference'],
    [{ ...base, email: E.admin, role: 'admin' }, 'admin-test'],
    [{ ...base, email: E.admin, role: 'admin', storeId: 's1' }, 'reference'],
    [{ ...base, email: 'ops@outside.example', role: 'admin' }, 'unclassified'],
    [{ ...base, email: E.refSeller, role: 'seller', storeId: 's1' }, 'reference'],
    [{ ...base, role: 'consumer' }, 'unclassified'],
  ];
  for (const [user, expected] of cases) {
    assert.equal(classifyAccount(user), expected, JSON.stringify(user));
  }
});

test('resolveAction은 남길 기록이 있으면 delete를 lock으로 낮추고 reference는 지정한 것만 처리한다', () => {
  assert.equal(resolveAction({ category: 'spec-temp', keptTotal: 0 }), 'delete');
  assert.equal(resolveAction({ category: 'spec-temp', keptTotal: 2 }), 'lock');
  assert.equal(resolveAction({ category: 'admin-test', keptTotal: 0 }), 'delete');
  assert.equal(resolveAction({ category: 'reference', keptTotal: 0 }), 'keep');
  assert.equal(resolveAction({ category: 'reference', keptTotal: 0, requested: 'lock' }), 'lock');
  assert.equal(resolveAction({ category: 'reference', keptTotal: 1, requested: 'delete' }), 'lock');
  assert.equal(
    resolveAction({ category: 'unclassified', keptTotal: 0, requested: 'delete' }),
    'keep',
  );
});

test('computePlanHash는 순서와 무관하고 대상·처리·프로젝트가 바뀌면 달라진다', () => {
  const key = 'f'.repeat(64);
  const a = { uid: 'u1', category: 'spec-temp', action: 'delete', role: 'consumer', emailKey: key };
  const b = { uid: 'u2', category: 'admin-test', action: 'delete', role: 'admin', emailKey: key };
  const hash = computePlanHash('p', [a, b]);
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(computePlanHash('p', [b, a]), hash);
  assert.notEqual(computePlanHash('p', [a, { ...b, action: 'lock' }]), hash);
  assert.notEqual(computePlanHash('p', [a]), hash);
  assert.notEqual(computePlanHash('q', [a, b]), hash);
});

test('parsePlan은 형식이 다른 계획 파일을 거부한다', () => {
  const entry = {
    uid: 'u1',
    category: 'spec-temp',
    action: 'delete',
    role: 'consumer',
    emailKey: 'a'.repeat(64),
  };
  const plan = (entries) => JSON.stringify({ version: 1, project: 'p', planHash: 'x', entries });
  assert.equal(parsePlan(plan([entry])).entries.length, 1);
  assert.throws(() => parsePlan('{'), RetireError);
  assert.throws(() => parsePlan(plan([entry, entry])), /항목 형식/);
  assert.throws(() => parsePlan(plan([{ ...entry, category: 'unclassified' }])), /항목 형식/);
  assert.throws(() => parsePlan(plan([{ ...entry, action: 'keep' }])), /항목 형식/);
  assert.throws(() => parsePlan(plan([{ ...entry, uid: 'users/u1' }])), /항목 형식/);
  assert.throws(() => parsePlan(plan([{ ...entry, emailKey: 'raw@example.com' }])), /항목 형식/);
  assert.throws(
    () => parsePlan(JSON.stringify({ version: 2, project: 'p', planHash: 'x', entries: [] })),
    /형식/,
  );
});

test('parseArgs는 명령별 인자만 받는다', () => {
  assert.deepEqual(parseArgs(['plan', '--out', 'a.json', '--include', 'abcdefgh=lock']), {
    command: 'plan',
    include: ['abcdefgh=lock'],
    out: 'a.json',
    plan: null,
    planHash: null,
  });
  assert.equal(parseArgs(applyArgs('h', PRODUCTION_WRITE_FLAG)).planHash, 'h');
  assert.throws(() => parseArgs([]), /사용법/);
  assert.throws(() => parseArgs(['plan', '--plan', 'x']), /알 수 없는 인자/);
  assert.throws(() => parseArgs(['apply', '--out', 'x']), /알 수 없는 인자/);
  assert.throws(() => parseArgs(['plan', '--out']), /값이 필요/);
  assert.throws(() => parseArgs(['plan', '--out', '--include']), /값이 필요/);
});

test('collectStrings는 중첩 객체·배열의 문자열만 모은다', () => {
  const found = collectStrings({
    a: 'x',
    b: [{ c: 'y' }, ['z']],
    t: FakeTimestamp.fromMillis(1),
    n: 3,
  });
  assert.deepEqual([...found].sort(), ['x', 'y', 'z']);
});

// ── plan ──────────────────────────────────────────────────────────────────────

test('plan은 아무것도 바꾸지 않고 마스킹한 사실과 계획 파일만 남긴다', async () => {
  const h = harness();
  assert.equal(await h.run(['plan', '--out', PLAN_PATH]), 0);
  const out = h.output();
  assertNoRawIdentifiers(out);
  assert.ok(!out.includes('010-0000-0001'));
  assert.ok(!out.includes('테스트 어드민'));
  assert.match(out, /mode: plan \(읽기 전용/);
  assert.match(out, /email provider 계정: 7/);
  assert.match(out, /분류: spec-temp:3,admin-test:1,reference:2,unclassified:1/);
  assert.match(
    out,
    /c0nsumer +c\*\*\*@example\.com .*연결문서=emailIdentities:1 남길기록=- 감사기록=0 → delete/,
  );
  assert.match(out, /dr1ver00 .*driver .*기사승인=no .*→ delete/);
  assert.match(out, /c0nsord0 .*남길기록=orders\.userId:1 .*→ lock/);
  assert.match(out, /adm1n000 +a\*\*\*@test\.com .*Auth=yes 세션=2 .*감사기록=1 → delete/);
  assert.match(out, /s3ller00 .*정지=yes .*남길기록=stores\.ownerId:1,users\.storeId:1 .*→ keep/);
  assert.match(out, /refcons1 .*→ keep/);
  assert.match(out, /\[unclassified\] 1건/);
  assert.match(out, /계획: delete:3,lock:1,keep:3/);
  assert.match(out, /남길 기록이 있어 delete 대신 lock: 1/);
  assert.match(
    out,
    /delete로 지울 것: users:3,emailIdentities:2,kakaoIdentities:0,aiUsage:0,refreshTokens:1,refreshSessions:1,firebaseAuth:1/,
  );

  const plan = h.plan();
  assert.equal(plan.project, 'green-e4fe3');
  assert.deepEqual(entryTuples(plan), [
    [U.admin, 'admin-test', 'delete'],
    [U.specWithOrder, 'spec-temp', 'lock'],
    [U.specConsumer, 'spec-temp', 'delete'],
    [U.specDriver, 'spec-temp', 'delete'],
  ]);
  assert.equal(plan.entries[0].emailKey, emailIdentityKey(E.admin));
  assert.equal(plan.planHash, computePlanHash('green-e4fe3', plan.entries));
  assert.match(out, new RegExp(`planHash: ${plan.planHash}`));
  assert.ok(!JSON.stringify(plan).includes('@'), '계획 파일에 이메일 원문이 없다');

  // 읽기만 한다: 쓰기·Auth 변경 없음, 카카오 실사용자 문서와 남길 기록의 내용은 읽지 않는다.
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fakeAuth.calls, []);
  assert.ok(!h.fake.reads.has(`users/${U.kakao}`));
  assert.ok(!h.fake.reads.has('orders/o1'));
  assert.ok(!h.fake.reads.has('stores/store-1'));
});

test('plan은 저장소 안 경로에 계획 파일을 쓰지 않는다', async () => {
  const h = harness();
  assert.equal(await h.run(['plan', '--out', resolve(REPO, 'tmp', 'plan.json')]), 1);
  assert.match(h.output(), /저장소 밖/);
  assert.equal(h.connected(), 0);
  assert.equal(await h.run(['plan']), 1);
  assert.match(h.output(), /--out/);
});

test('plan --include는 reference 계정 하나만 계획에 넣는다', async () => {
  const h = harness();
  assert.equal(
    await h.run([
      'plan',
      '--out',
      PLAN_PATH,
      '--include',
      'refcons1=lock',
      '--include',
      's3ller00=delete',
    ]),
    0,
  );
  const tuples = entryTuples(h.plan());
  assert.deepEqual(
    tuples.filter(([, category]) => category === 'reference'),
    [
      [U.refConsumer, 'reference', 'lock'],
      // 매장이 연결된 판매자는 delete를 지정해도 lock으로 낮춘다.
      [U.refSeller, 'reference', 'lock'],
    ],
  );

  for (const [spec, message] of [
    ['c0nsumer=delete', /reference 계정만/],
    ['outsid3r=lock', /reference 계정만/],
    ['zzzzzzzz=lock', /일치하는 계정이 0개/],
    ['refcons1=keep', /형식/],
    ['ref=lock', /형식/],
  ]) {
    h.reset();
    assert.equal(await h.run(['plan', '--out', PLAN_PATH, '--include', spec]), 1, spec);
    assert.match(h.output(), message, spec);
  }
});

test('lastSessionActivity·lastAuthActivity는 세션·Auth의 마지막 사용 시각을 고른다', () => {
  const may = Date.UTC(2026, 4, 25);
  const june = Date.UTC(2026, 5, 2);
  assert.equal(lastSessionActivity(null), null);
  assert.equal(lastSessionActivity({ sessions: { s1: { token: 't' } } }), null);
  assert.equal(
    lastSessionActivity({
      sessions: { s1: { createdAt: may }, s2: { createdAt: may, rotatedAt: june } },
    }),
    june,
  );
  assert.equal(lastSessionActivity({ token: 't', updatedAt: FakeTimestamp.fromMillis(may) }), may);
  assert.equal(lastAuthActivity({ metadata: {} }), null);
  assert.equal(
    lastAuthActivity({
      metadata: {
        lastSignInTime: new Date(may).toUTCString(),
        lastRefreshTime: new Date(june).toUTCString(),
      },
    }),
    june,
  );
});

test('plan은 세션·Auth 사용 기록이 있으면 마지막 사용 날짜를 함께 보인다', async () => {
  const h = harness({
    seed: baseSeed({
      [`refreshTokens/${U.admin}`]: {
        sessions: { s1: { token: 'a'.repeat(64), createdAt: Date.UTC(2026, 4, 25) } },
      },
    }),
    authUsers: {
      [U.admin]: {
        uid: U.admin,
        disabled: false,
        metadata: { lastSignInTime: new Date(Date.UTC(2026, 4, 26)).toUTCString() },
      },
    },
  });
  assert.equal(await h.run(['plan', '--out', PLAN_PATH]), 0);
  assert.match(h.output(), /adm1n000 .*Auth=yes\(최근 2026-05-26\) 세션=2\(최근 2026-05-25\)/);
});

test('plan은 운영 이슈 조치 기록의 중첩 참조도 남길 기록으로 센다', async () => {
  const h = harness({
    seed: baseSeed({
      'operationIssues/i1': {
        storeId: 'store-x',
        actions: [{ actorId: U.admin, type: 'RETRY_REFUND' }],
        resolution: null,
      },
    }),
  });
  assert.equal(await h.run(['plan', '--out', PLAN_PATH]), 0);
  assert.match(h.output(), /adm1n000 .*남길기록=operationIssues\.nested:1 .*→ lock/);
  assert.deepEqual(entryTuples(h.plan())[0], [U.admin, 'admin-test', 'lock']);
});

// ── apply ─────────────────────────────────────────────────────────────────────

test('apply는 확인된 계획의 uid만 지우거나 잠그고, 남길 기록과 기존 감사 기록은 그대로 둔다', async () => {
  const h = harness();
  await h.run(['plan', '--out', PLAN_PATH]);
  const { planHash } = h.plan();
  h.reset();

  assert.equal(await quietly(() => h.run(applyArgs(planHash, PRODUCTION_WRITE_FLAG))), 0);
  const out = h.output();
  assertNoRawIdentifiers(out);
  assert.match(out, /결과: deleted:3,locked:1/);

  const { docs } = h.fake;
  for (const key of ['specConsumer', 'specDriver', 'admin'])
    assert.ok(!docs.has(`users/${U[key]}`), key);
  assert.ok(!docs.has(`emailIdentities/${emailIdentityKey(E.specConsumer)}`));
  assert.ok(!docs.has(`emailIdentities/${emailIdentityKey(E.specDriver)}`));
  assert.ok(!docs.has(`refreshTokens/${U.admin}`));
  assert.ok(!docs.has(`refreshTokens/${U.admin}/sessions/s1`));
  assert.deepEqual(
    h.fakeAuth.calls.filter(([call]) => call === 'deleteUser'),
    [['deleteUser', U.admin]],
  );

  // 남길 기록·계획 밖 계정은 그대로다.
  assert.ok(docs.has('auditLogs/a1'));
  assert.ok(docs.has('orders/o1'));
  assert.ok(docs.has('stores/store-1'));
  for (const key of ['refSeller', 'refConsumer', 'kakao', 'outsider']) {
    assert.deepEqual(docs.get(`users/${U[key]}`), baseSeed()[`users/${U[key]}`], key);
  }

  const locked = docs.get(`users/${U.specWithOrder}`);
  assert.equal(locked.suspended, true);
  assert.equal(locked.passwordHash, NEW_HASH);
  assert.deepEqual(locked.activeSessionIds, []);
  assert.equal(locked.sessionsRevokedAt.toMillis(), Math.floor(NOW / 1000) * 1000);

  const audits = [...docs.entries()]
    .filter(([path]) => path.startsWith('auditLogs/') && path !== 'auditLogs/a1')
    .map(([, doc]) => doc);
  assert.deepEqual(
    audits.map((a) => `${a.action} ${a.userId}`).sort(),
    [
      `${DELETE_AUDIT_ACTION} ${U.admin}`,
      `${DELETE_AUDIT_ACTION} ${U.specConsumer}`,
      `${DELETE_AUDIT_ACTION} ${U.specDriver}`,
      `${LOCK_AUDIT_ACTION} ${U.specWithOrder}`,
    ].sort(),
  );
  const adminAudit = audits.find((a) => a.userId === U.admin);
  assert.deepEqual(adminAudit.detail, {
    tool: 'retire-test-accounts.mjs',
    category: 'admin-test',
    role: 'admin',
    removed: { refreshSessions: 2, firebaseAuthUser: true },
  });
  assert.equal(audits.find((a) => a.userId === U.specConsumer).detail.removed.emailIdentities, 1);

  // 다시 실행해도 같은 결과다.
  h.reset();
  assert.equal(await quietly(() => h.run(applyArgs(planHash, PRODUCTION_WRITE_FLAG))), 0);
  assert.match(h.output(), /결과: locked:1,already-done:3/);
  assert.match(h.output(), /c0nsord0 .*→ locked \(이미 잠겨 있었음\)/);
});

test('apply는 planHash·운영 확인 인자·프로젝트가 맞지 않으면 접속 전에 멈춘다', async () => {
  const h = harness();
  await h.run(['plan', '--out', PLAN_PATH]);
  const plan = h.plan();
  const before = h.connected();

  const refusals = [
    [applyArgs('0'.repeat(16), PRODUCTION_WRITE_FLAG), /planHash/],
    [applyArgs(plan.planHash), /--allow-production=green-e4fe3/],
    [applyArgs(plan.planHash, '--allow-production'), /--allow-production=green-e4fe3/],
    [['apply', '--plan', PLAN_PATH, PRODUCTION_WRITE_FLAG], /--plan-hash/],
  ];
  for (const [argv, message] of refusals) {
    h.reset();
    assert.equal(await quietly(() => h.run(argv)), 1, argv.join(' '));
    assert.match(h.output(), message, argv.join(' '));
  }

  // 계획 파일을 고치면 계획 파일 안의 planHash와도 맞지 않는다.
  const tampered = { ...plan, entries: plan.entries.map((e) => ({ ...e, action: 'delete' })) };
  h.files.set(PLAN_PATH, JSON.stringify(tampered));
  h.reset();
  assert.equal(await quietly(() => h.run(applyArgs(plan.planHash, PRODUCTION_WRITE_FLAG))), 1);
  assert.match(h.output(), /planHash/);

  // 다른 프로젝트 키로는 계획을 적용하지 않는다.
  const staging = harness({
    project: 'greenhub-staging',
    files: new Map([[PLAN_PATH, JSON.stringify(plan)]]),
  });
  assert.equal(await staging.run(applyArgs(plan.planHash)), 1);
  assert.match(staging.output(), /프로젝트/);

  assert.equal(h.connected(), before);
  assert.equal(staging.connected(), 0);
  assert.deepEqual(h.fake.writes, []);
  assert.deepEqual(h.fakeAuth.calls, []);
});

test('apply는 계획 뒤 바뀐 계정을 건너뛰고 나머지만 처리한다', async () => {
  const h = harness();
  await h.run(['plan', '--out', PLAN_PATH]);
  const { planHash } = h.plan();
  // 계획 뒤: 기사 계정의 role이 바뀌고, 소비자 계정에 주문이 생겼다.
  h.fake.docs.set(`users/${U.specDriver}`, {
    ...h.fake.docs.get(`users/${U.specDriver}`),
    role: 'consumer',
  });
  h.fake.docs.set('orders/o9', { userId: U.specConsumer, storeId: 'store-x' });
  h.reset();

  assert.equal(await quietly(() => h.run(applyArgs(planHash, PRODUCTION_WRITE_FLAG))), 1);
  const out = h.output();
  assertNoRawIdentifiers(out);
  assert.match(out, /dr1ver00 .*→ skipped \(계획 뒤 계정 정보가 바뀜\)/);
  assert.match(out, /c0nsumer .*→ skipped \(남길 기록 발견 orders\.userId:1\)/);
  assert.match(out, /결과: deleted:1,locked:1,skipped:2/);
  assert.ok(h.fake.docs.has(`users/${U.specDriver}`));
  assert.ok(h.fake.docs.has(`users/${U.specConsumer}`));
  assert.ok(h.fake.docs.has(`emailIdentities/${emailIdentityKey(E.specConsumer)}`));
  assert.ok(!h.fake.docs.has(`users/${U.admin}`));
});

test('apply는 Firestore 삭제 뒤 남은 Firebase Auth 사용자를 다시 실행할 때 마저 지운다', async () => {
  const h = harness();
  await h.run(['plan', '--out', PLAN_PATH]);
  const { planHash } = h.plan();
  const realDelete = h.fakeAuth.auth.deleteUser;
  h.fakeAuth.auth.deleteUser = async (uid) => {
    throw new Error(`boom users/${uid}`);
  };
  h.reset();

  assert.equal(await quietly(() => h.run(applyArgs(planHash, PRODUCTION_WRITE_FLAG))), 1);
  let out = h.output();
  assertNoRawIdentifiers(out);
  assert.match(out, /adm1n000 .*→ failed \(Error boom users\/adm1n000…\)/);
  assert.ok(!h.fake.docs.has(`users/${U.admin}`));
  assert.ok(h.fakeAuth.state[U.admin]);

  h.fakeAuth.auth.deleteUser = realDelete;
  h.reset();
  assert.equal(await quietly(() => h.run(applyArgs(planHash, PRODUCTION_WRITE_FLAG))), 0);
  out = h.output();
  assert.match(out, /adm1n000 .*→ deleted \(남은 연결 문서만 정리\)/);
  assert.ok(!h.fakeAuth.state[U.admin]);
});
