import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  AUDIT_ACTION,
  allowedUntilMillis,
  buildUserDocument,
  DEFAULT_ALLOWED_DAYS,
  DEFAULT_NAME,
  REVIEW_REASON,
  readInputs,
  run,
} from './create-email-review-account.mjs';

const EMAIL = 'Review.Fixture@Example.test';
const NORMALIZED = 'review.fixture@example.test';
const MASKED = 'r***@e***.test';
// bcrypt 해시 형식: $2b$<cost>$ + 53자(salt 22 + hash 31). 값 자체는 픽스처다.
const HASH_BODY = 'fixtureHashValueForSpecOnly'.padEnd(53, '0');
const HASH = `$2b$12$${HASH_BODY}`;
const KEY_PATH = '/fixture/sa.json';
const NOW = Date.UTC(2026, 9, 27, 6, 0, 0, 0);
const DAY = 86_400_000;
const identityKey = createHash('sha256').update(NORMALIZED, 'utf8').digest('hex');

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

// 최소 Firestore 흉내: users 컬렉션의 email 질의, 문서 get/set, 트랜잭션 get/create/set.
function createFakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];
  const docRef = (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data) => {
      writes.push(['set', path]);
      docs.set(path, data);
    },
  });
  const db = {
    doc: docRef,
    collection: (name) => ({
      where: (field, op, value) => ({
        limit: () => ({
          get: async () => {
            assert.equal(name, 'users');
            assert.equal(field, 'email');
            assert.equal(op, '==');
            const hits = [...docs.entries()]
              .filter(([p, d]) => p.startsWith('users/') && d.email === value)
              .map(([, d]) => ({ data: () => d }));
            return { empty: hits.length === 0, docs: hits };
          },
        }),
      }),
    }),
    runTransaction: async (fn) =>
      fn({
        get: async (ref) => ref.get(),
        create: (ref, data) => {
          if (docs.has(ref.path)) throw new Error('already exists');
          writes.push(['create', ref.path]);
          docs.set(ref.path, data);
        },
        set: (ref, data) => {
          writes.push(['set', ref.path]);
          docs.set(ref.path, data);
        },
      }),
  };
  return { db, docs, writes };
}

function harness({ seed, env = {}, argv, project } = {}) {
  const fake = createFakeDb(seed);
  const lines = [];
  let connected = 0;
  const options = {
    argv: argv ?? [],
    env: {
      REVIEW_EMAIL: EMAIL,
      REVIEW_MODE: 'check',
      GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
      ...env,
    },
    write: (line) => lines.push(line),
    loadFile: async (path) => {
      assert.equal(path, KEY_PATH);
      return JSON.stringify({ project_id: project ?? 'green-e4fe3', private_key: 'fixture' });
    },
    connect: async () => {
      connected += 1;
      return { db: fake.db, Timestamp: FakeTimestamp };
    },
    now: () => NOW,
  };
  return {
    fake,
    lines,
    connected: () => connected,
    run: () => run(options),
    output: () => lines.join('\n'),
  };
}

const usersOf = (h) => [...h.fake.docs.entries()].filter(([p]) => p.startsWith('users/'));
const auditsOf = (h) =>
  [...h.fake.docs.entries()].filter(([p]) => p.startsWith('auditLogs/')).map(([, d]) => d);

function assertPublicSafe(out, { uid } = {}) {
  assert.ok(!out.includes(EMAIL), 'email original must not appear');
  assert.ok(!out.includes(NORMALIZED), 'normalized email must not appear');
  assert.ok(!out.includes(HASH), 'password hash must not appear');
  assert.ok(!out.includes('uidPrefix'), 'uid prefix is detail only');
  if (uid) assert.ok(!out.includes(uid), 'uid must not appear');
}

// ── 입력 검증 ─────────────────────────────────────────────────────────────────

test('readInputs: 기본값은 check·30일·기본 이름이고 이메일은 소문자로 정규화한다', () => {
  const inputs = readInputs({ REVIEW_EMAIL: `  ${EMAIL} ` });
  assert.deepEqual(inputs, {
    email: NORMALIZED,
    mode: 'check',
    allowedDays: DEFAULT_ALLOWED_DAYS,
    name: DEFAULT_NAME,
    passwordHash: null,
  });
});

test('readInputs: create는 bcrypt 해시(cost 10 이상)를 요구하고 평문·약한 cost를 거부한다', () => {
  const base = { REVIEW_EMAIL: EMAIL, REVIEW_MODE: 'create' };
  assert.equal(readInputs({ ...base, REVIEW_PASSWORD_HASH: HASH }).passwordHash, HASH);
  for (const bad of [
    undefined,
    '',
    'plain-password-123',
    `$2b$04$${HASH_BODY}`,
    `$2b$12$${HASH_BODY.slice(1)}`,
    '$1$abc',
  ]) {
    assert.throws(() => readInputs({ ...base, REVIEW_PASSWORD_HASH: bad }), /bcrypt/);
  }
});

test('readInputs: 모드·이메일·허용 일수·이름의 잘못된 값을 거부한다', () => {
  assert.throws(() => readInputs({ REVIEW_EMAIL: EMAIL, REVIEW_MODE: 'lock' }), /REVIEW_MODE/);
  for (const email of ['', 'nope', 'a@b', 'a b@example.test', `${'x'.repeat(250)}@example.test`]) {
    assert.throws(() => readInputs({ REVIEW_EMAIL: email }), /REVIEW_EMAIL/);
  }
  for (const days of ['0', '91', '1.5', 'abc', '-3']) {
    assert.throws(
      () => readInputs({ REVIEW_EMAIL: EMAIL, REVIEW_ALLOWED_DAYS: days }),
      /REVIEW_ALLOWED_DAYS/,
    );
  }
  assert.equal(readInputs({ REVIEW_EMAIL: EMAIL, REVIEW_ALLOWED_DAYS: '90' }).allowedDays, 90);
  for (const name of ['x'.repeat(21), 'bad\u0007name', 'https://evil.test', 'www.evil.test']) {
    assert.throws(() => readInputs({ REVIEW_EMAIL: EMAIL, REVIEW_NAME: name }), /REVIEW_NAME/);
  }
  assert.equal(
    readInputs({ REVIEW_EMAIL: EMAIL, REVIEW_NAME: ' 카카오페이 심사 ' }).name,
    '카카오페이 심사',
  );
});

// ── 문서 구성 ─────────────────────────────────────────────────────────────────

test('buildUserDocument: API 이메일 가입과 같은 필드에 심사 허용 표식을 더한다', () => {
  const doc = buildUserDocument({
    userId: 'uid-1',
    email: NORMALIZED,
    name: DEFAULT_NAME,
    passwordHash: HASH,
    allowedDays: 30,
    nowMillis: NOW,
    Timestamp: FakeTimestamp,
  });
  assert.deepEqual(Object.keys(doc).sort(), [
    'createdAt',
    'email',
    'emailLoginAllowedReason',
    'emailLoginAllowedUntil',
    'fcmToken',
    'id',
    'name',
    'passwordHash',
    'phone',
    'providers',
    'role',
    'savedAddresses',
    'storeId',
    'updatedAt',
  ]);
  assert.equal(doc.role, 'consumer');
  assert.equal(doc.storeId, null);
  assert.deepEqual(doc.providers, ['email']);
  assert.equal(doc.emailLoginAllowedReason, REVIEW_REASON);
  assert.equal(doc.createdAt.toMillis(), NOW);
  assert.equal(doc.emailLoginAllowedUntil.toMillis(), NOW + 30 * DAY);
  assert.equal(allowedUntilMillis(doc), NOW + 30 * DAY);
  assert.equal(allowedUntilMillis({}), null);
  assert.equal(allowedUntilMillis({ emailLoginAllowedUntil: 'tomorrow' }), null);
});

// ── 실행 ─────────────────────────────────────────────────────────────────────

test('check: 계정이 없으면 found 0을 내고 아무것도 쓰지 않는다', async () => {
  const h = harness();
  assert.equal(await h.run(), 0);
  assert.equal(h.connected(), 1);
  assert.match(h.output(), /mode: check\nfound: 0/);
  assert.deepEqual(h.fake.writes, []);
  assertPublicSafe(h.output());
});

test('check: 기존 계정의 role·정지·심사 허용 여부·만료 시각만 낸다(이메일·uid 없음)', async () => {
  const h = harness({
    seed: {
      'users/user-fixture-1': {
        id: 'user-fixture-1',
        email: NORMALIZED,
        role: 'consumer',
        suspended: false,
        emailLoginAllowedUntil: FakeTimestamp.fromMillis(NOW + DAY),
      },
    },
  });
  assert.equal(await h.run(), 0);
  const out = h.output();
  assert.match(
    out,
    /found: 1\nrole: consumer\nsuspended: no\nemailLoginAllowed: yes\nallowedUntil: 2026-10-28T06:00:00\.000Z/,
  );
  assertPublicSafe(out, { uid: 'user-fixture-1' });
  assert.deepEqual(h.fake.writes, []);
});

test('check --detail(로컬)은 마스킹 이메일과 uid 앞 8자를 더 낸다', async () => {
  const h = harness({
    argv: ['--detail'],
    seed: { 'users/user-fixture-1': { id: 'user-fixture-1', email: NORMALIZED, role: 'consumer' } },
  });
  assert.equal(await h.run(), 0);
  assert.ok(h.output().includes(`email: ${MASKED}`), 'masked email must appear in detail');
  assert.match(h.output(), /uidPrefix: user-fix/);
  assert.match(h.output(), /emailLoginAllowed: no\nallowedUntil: n\/a/);
});

test('--detail은 CI 환경에서 연결 전에 거부한다', async () => {
  const h = harness({ argv: ['--detail'], env: { GITHUB_ACTIONS: 'true' } });
  assert.equal(await h.run(), 1);
  assert.equal(h.connected(), 0);
  assert.match(h.output(), /--detail/);
});

test('create: users·emailIdentities를 한 트랜잭션으로 만들고 감사 기록을 남긴다', async () => {
  const h = harness({
    env: { REVIEW_MODE: 'create', REVIEW_PASSWORD_HASH: HASH, REVIEW_ALLOWED_DAYS: '14' },
  });
  assert.equal(await h.run(), 0);

  const users = usersOf(h);
  assert.equal(users.length, 1);
  const [path, user] = users[0];
  assert.equal(path, `users/${user.id}`);
  assert.equal(user.email, NORMALIZED);
  assert.equal(user.passwordHash, HASH);
  assert.equal(user.role, 'consumer');
  assert.equal(user.emailLoginAllowedUntil.toMillis(), NOW + 14 * DAY);

  const identity = h.fake.docs.get(`emailIdentities/${identityKey}`);
  assert.deepEqual(identity, { userId: user.id, email: NORMALIZED, createdAt: user.createdAt });

  const audits = auditsOf(h);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, AUDIT_ACTION);
  assert.equal(audits[0].userId, user.id);
  assert.deepEqual(audits[0].detail, {
    role: 'consumer',
    reason: REVIEW_REASON,
    allowedDays: 14,
    allowedUntil: NOW + 14 * DAY,
  });
  assert.ok(!JSON.stringify(audits[0]).includes(NORMALIZED), 'audit must not carry the email');

  assert.deepEqual(
    h.fake.writes.map(([op, p]) => `${op}:${p.split('/')[0]}`),
    ['create:emailIdentities', 'set:users', 'set:auditLogs'],
  );
  const out = h.output();
  assert.match(
    out,
    /mode: create\nfound: 0\nresult: created\nrole: consumer\nallowedDays: 14\nallowedUntil: 2026-11-10T06:00:00\.000Z/,
  );
  assertPublicSafe(out, { uid: user.id });
});

test('create: users.email로 이미 있으면 아무것도 바꾸지 않고 exit 1', async () => {
  const h = harness({
    env: { REVIEW_MODE: 'create', REVIEW_PASSWORD_HASH: HASH },
    seed: { 'users/user-fixture-1': { id: 'user-fixture-1', email: NORMALIZED, role: 'consumer' } },
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /found: 1[\s\S]*result: already-exists/);
  assert.deepEqual(h.fake.writes, []);
  assertPublicSafe(h.output(), { uid: 'user-fixture-1' });
});

test('create: emailIdentities로 연결된 계정이 있으면 그 계정으로 보고 만들지 않는다', async () => {
  const h = harness({
    env: { REVIEW_MODE: 'create', REVIEW_PASSWORD_HASH: HASH },
    seed: {
      [`emailIdentities/${identityKey}`]: { userId: 'user-fixture-2', email: NORMALIZED },
      'users/user-fixture-2': {
        id: 'user-fixture-2',
        email: 'Other.Case@Example.test',
        role: 'seller',
      },
    },
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /found: 1\nrole: seller[\s\S]*result: already-exists/);
  assert.deepEqual(h.fake.writes, []);
});

test('create: 연결 문서만 남아 있으면 막고 정리를 안내한다', async () => {
  const h = harness({
    env: { REVIEW_MODE: 'create', REVIEW_PASSWORD_HASH: HASH },
    seed: { [`emailIdentities/${identityKey}`]: { userId: 'ghost', email: NORMALIZED } },
  });
  assert.equal(await h.run(), 1);
  assert.match(h.output(), /found: identity-only\nresult: blocked/);
  assert.deepEqual(h.fake.writes, []);
});

test('create: 해시가 없으면 연결 전에 거부한다', async () => {
  const h = harness({ env: { REVIEW_MODE: 'create' } });
  assert.equal(await h.run(), 1);
  assert.equal(h.connected(), 0);
  assert.match(h.output(), /REVIEW_PASSWORD_HASH/);
});

test('운영이 아닌 프로젝트의 키는 연결 전에 거부한다', async () => {
  const h = harness({ project: 'greenhub-round-direct-e2e' });
  assert.equal(await h.run(), 1);
  assert.equal(h.connected(), 0);
  assert.match(h.output(), /운영\(green-e4fe3\)이 아니어서 거부/);
});

test('예상 밖 오류 메시지에 섞인 입력 이메일은 마스킹된다', async () => {
  const h = harness();
  h.fake.db.collection = () => {
    throw new Error(`boom at ${EMAIL}`);
  };
  assert.equal(await h.run(), 1);
  assert.ok(!h.output().includes(EMAIL));
  assert.match(h.output(), /실패: /);
});
