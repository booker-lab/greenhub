import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_KEY_BASENAME,
  collect,
  EXPECTED_PROJECT_ID,
  FIELD_ALLOWLIST,
  KEY_ENV,
  loadReadonlyCredentials,
  OpsCheckStop,
  run,
} from './morning-check.mjs';

// 2026-10-22 07:30 KST
const NOW = Date.UTC(2026, 9, 21, 22, 30);
const DAY = 24 * 60 * 60 * 1000;
const OPS_EMAIL = 'ops-readonly@fixture.iam.example.test';
const KEY_PATH = '/fixture/ops/readonly-key.json';
const CONFIG_PATH = '/fixture/ops/config.json';

const SOURCE_FILES = ['morning-check.mjs', 'morning-check-rules.mjs', 'morning-check-history.mjs'];
const readSource = (name) => readFile(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

/** 보고·조회에 절대 나오면 안 되는 필드(§3-3 금지 목록). */
const FORBIDDEN_FIELDS = [
  'deliveryAddress',
  'deliveryPhone',
  'requestNote',
  'gift',
  'buyerName',
  'buyerPhone',
  'address',
  'userId',
  'deliveryHold.reasonMessage',
  'reasonMessage',
  'recipientEmail',
  'ip',
  'detail',
  'passwordHash',
  'savedAddresses',
  'activeSessionIds',
  'email',
  'phone',
  'ownerId',
  'usedBy',
  'createdBy',
];
/** 손님 정보 표식. 가짜 문서에 심어 두고 보고에 섞이는지 본다. */
const PII_MARKERS = ['손님홍길동', '010-0000-0000', '서울시 표식구', 'buyer@fixture.example.test', '선물메모표식'];

// ── 가짜 Firestore: select·fieldMask를 기록하고, 쓰기 메서드는 부르면 바로 실패한다 ─────────────

function project(data, fields) {
  const out = {};
  for (const field of fields) {
    const parts = field.split('.');
    let src = data;
    for (const part of parts) src = src?.[part];
    if (src === undefined) continue;
    let dst = out;
    parts.slice(0, -1).forEach((part) => {
      dst[part] = dst[part] ?? {};
      dst = dst[part];
    });
    dst[parts[parts.length - 1]] = src;
  }
  return out;
}

function valueAt(data, field) {
  return field.split('.').reduce((obj, key) => obj?.[key], data);
}

function compare(value, op, target) {
  const v = value?.toMillis ? value.toMillis() : value instanceof Date ? value.getTime() : value;
  const t = target instanceof Date ? target.getTime() : target;
  switch (op) {
    case '==':
      return v === t;
    case 'in':
      return t.includes(v);
    case '>':
      return v > t;
    case '>=':
      return v >= t;
    case '<':
      return v < t;
    case '<=':
      return v <= t;
    default:
      throw new Error(`가짜 Firestore가 모르는 연산: ${op}`);
  }
}

const WRITE_METHODS = ['set', 'update', 'delete', 'add', 'create', 'batch', 'runTransaction', 'bulkWriter', 'recursiveDelete'];

function failOnWrite(target, label) {
  for (const method of WRITE_METHODS) {
    target[method] = () => {
      throw new Error(`쓰기 호출 금지: ${label}.${method}`);
    };
  }
  return target;
}

/**
 * seed: { collection: { docId: data } }
 * options.ignoreProjection: true면 select를 기록만 하고 문서 전체를 돌려준다(보고 단계의 방어를 따로 검사).
 */
function createFakeDb(seed, { ignoreProjection = false, failCollections = [] } = {}) {
  const calls = [];

  const makeQuery = (collection, filters) => {
    const query = {
      where(field, op, value) {
        return makeQuery(collection, [...filters, { field, op, value }]);
      },
      select(...fields) {
        return {
          async get() {
            calls.push({ kind: 'query', collection, fields, filters });
            if (failCollections.includes(collection)) {
              const error = new Error(`읽기 실패 documents/${collection}/secret-id`);
              error.code = 'permission-denied';
              throw error;
            }
            const docs = Object.entries(seed[collection] ?? {})
              .filter(([, data]) => filters.every((f) => compare(valueAt(data, f.field), f.op, f.value)))
              .map(([id, data]) => ({ id, data: () => (ignoreProjection ? data : project(data, fields)) }));
            return { docs };
          },
        };
      },
      get() {
        throw new Error(`select 없이 get 호출: ${collection}`);
      },
    };
    return failOnWrite(query, `query(${collection})`);
  };

  const db = {
    calls,
    collection(name) {
      const ref = makeQuery(name, []);
      ref.doc = (id) => failOnWrite({ __collection: name, id, get: () => { throw new Error('fieldMask 없이 문서 get 호출'); } }, `doc(${name})`);
      return ref;
    },
    async getAll(...args) {
      const last = args[args.length - 1];
      if (!last || !Array.isArray(last.fieldMask)) throw new Error('fieldMask 없이 getAll 호출');
      const refs = args.slice(0, -1);
      calls.push({ kind: 'getAll', collection: refs[0]?.__collection, fields: last.fieldMask });
      return refs.map((ref) => {
        const data = seed[ref.__collection]?.[ref.id];
        return {
          id: ref.id,
          exists: data !== undefined,
          data: () => (data === undefined ? undefined : ignoreProjection ? data : project(data, last.fieldMask)),
        };
      });
    },
  };
  return failOnWrite(db, 'db');
}

const ts = (ms) => ({ toMillis: () => ms });
const pii = {
  buyerName: PII_MARKERS[0],
  buyerPhone: PII_MARKERS[1],
  deliveryAddress: PII_MARKERS[2],
  deliveryPhone: PII_MARKERS[1],
  requestNote: PII_MARKERS[4],
  gift: { message: PII_MARKERS[4] },
  userId: 'user-secret-id',
};

/** 기준마다 이상이 하나씩 걸리는 운영 데이터 흉내. 모든 문서에 손님 정보 표식을 섞는다. */
function seedData() {
  return {
    stores: {
      'store-a': { name: '디어 오키드', status: 'active', commissionRate: 0.03, ownerId: 'owner-secret', phone: PII_MARKERS[1] },
      'store-b': { name: '난플렉스', status: 'active' },
    },
    settlements: {
      'order-m1': { status: 'paid', storeId: 'store-a', orderNumber: '20261021-000012', netAmount: 32000, platformFeeRate: 0.05, paidAt: ts(NOW - DAY), settledAt: ts(NOW - 5 * DAY) },
      'order-ok': { status: 'pending', storeId: 'store-a', orderNumber: '20261021-000099', netAmount: 1000, platformFeeRate: 0.05, settledAt: ts(NOW - DAY) },
    },
    orders: {
      'order-m1': { status: 'CANCELLED', storeId: 'store-a', orderNumber: '20261021-000012', ...pii },
      'order-o1': { status: 'PREPARING', storeId: 'store-b', orderNumber: '20261021-000015', roundId: 'round-past', deliveryMethod: 'direct', driverId: 'driver-1', totalAmount: 45000, updatedAt: ts(NOW - DAY), ...pii },
      'order-o2': { status: 'ACCEPTED', storeId: 'store-a', orderNumber: '20261022-000001', roundId: 'round-today', deliveryMethod: 'direct', totalAmount: 30000, updatedAt: ts(NOW), ...pii },
      'order-o3': { status: 'PREPARING', storeId: 'store-a', orderNumber: '20261022-000002', roundId: 'round-today', deliveryMethod: 'direct', driverId: null, totalAmount: 30000, updatedAt: ts(NOW), ...pii },
      'order-normal': { status: 'ACCEPTED', storeId: 'store-b', orderNumber: '20261019-000003', roundId: null, requestedDeliveryDate: '2026-10-20', updatedAt: ts(NOW - 2 * DAY), ...pii },
      'order-o4': { status: 'DELIVERY_HELD', storeId: 'store-b', orderNumber: '20261019-000004', roundId: null, deliveryHold: { heldAt: new Date(NOW - 2 * DAY).toISOString(), resolvedAt: null, reasonCode: 'ABSENT', reasonMessage: PII_MARKERS[4] }, updatedAt: ts(NOW - 2 * DAY), ...pii },
    },
    payments: {
      'order-m1': { status: 'REFUNDED', refundedAt: ts(NOW - HOUR()), refundAmount: 34000, buyerName: PII_MARKERS[0] },
    },
    saleRounds: {
      'round-past': { storeId: 'store-b', name: '10월 3주 회차', status: 'CLOSED', schedule: { deliveryStartAt: '2026-10-20T09:00:00+09:00', deliveryEndAt: '2026-10-21T18:00:00+09:00' } },
      'round-today': { storeId: 'store-a', name: '10월 4주 회차', status: 'CLOSED', schedule: { deliveryStartAt: '2026-10-22T09:00:00+09:00', deliveryEndAt: '2026-10-22T18:00:00+09:00' } },
      'round-old': { storeId: 'store-a', name: '9월 회차', status: 'COMPLETED', schedule: { deliveryStartAt: '2026-09-01T09:00:00Z', deliveryEndAt: '2026-09-01T18:00:00Z' } },
    },
    users: {
      'driver-1': { role: 'driver', driverApproved: true, suspended: false, email: 'driver@fixture.example.test', name: PII_MARKERS[0], passwordHash: 'hash' },
      'driver-2': { role: 'driver', driverApproved: false, suspended: false, email: 'driver2@fixture.example.test', phone: PII_MARKERS[1] },
      'consumer-1': { role: 'consumer', email: PII_MARKERS[3], savedAddresses: [PII_MARKERS[2]] },
    },
    invites: {
      'invite-1': { expiresAt: ts(NOW + 3 * HOUR()), usedAt: null, revokedAt: null, createdAt: ts(NOW - 2 * DAY), recipientEmail: PII_MARKERS[3], createdBy: 'admin-secret' },
    },
    auditLogs: {
      'log-1': { action: 'payment.webhook.invalid_sig', createdAt: ts(NOW - HOUR()), ip: '203.0.113.9', userId: 'user-secret-id', detail: { email: PII_MARKERS[3] } },
    },
    operationIssues: {
      'issue-1': { type: 'PAYMENT_LOOKUP_FAILED', severity: 'critical', status: 'OPEN', storeId: 'store-a', createdAt: ts(NOW - HOUR()), detail: { buyerName: PII_MARKERS[0] } },
      'issue-2': { type: 'REFUND_RETRY', severity: 'warning', status: 'RESOLVED', storeId: 'store-a', createdAt: ts(NOW - HOUR()) },
    },
  };
}
function HOUR() {
  return 60 * 60 * 1000;
}

function createMemoryFs(initial = {}) {
  // 경로 구분자를 '/'로 맞춘다(Windows의 path.join 결과도 같은 키가 된다).
  const norm = (path) => String(path).replace(/\\/g, '/');
  const files = {};
  for (const [path, text] of Object.entries(initial)) files[norm(path)] = text;
  return {
    files,
    async mkdir() {},
    async readdir(dir) {
      const prefix = `${norm(dir)}/`;
      return Object.keys(files)
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length));
    },
    async readFile(path) {
      if (!(norm(path) in files)) throw Object.assign(new Error('없음'), { code: 'ENOENT' });
      return files[norm(path)];
    },
    async writeFile(path, text) {
      files[norm(path)] = text;
    },
    async rm(path) {
      delete files[norm(path)];
    },
  };
}

const validKey = (overrides = {}) =>
  JSON.stringify({
    type: 'service_account',
    project_id: EXPECTED_PROJECT_ID,
    client_email: OPS_EMAIL,
    private_key: 'fixture-not-a-key',
    ...overrides,
  });
const validConfig = (overrides = {}) => JSON.stringify({ serviceAccountEmail: OPS_EMAIL, keyCreatedAt: '2026-10-21', ...overrides });

function fakeReader(files) {
  const reads = [];
  const readText = async (path) => {
    reads.push(path);
    if (!(path in files)) throw Object.assign(new Error('없음'), { code: 'ENOENT' });
    return files[path];
  };
  return { readText, reads };
}

// ── 소스 고정 검사 ───────────────────────────────────────────────────────────

describe('소스 고정 검사', () => {
  for (const name of SOURCE_FILES) {
    test(`${name}에 Firestore 쓰기 호출이 없다`, async () => {
      const source = await readSource(name);
      for (const method of ['set', 'update', 'delete', 'add', 'create', 'batch']) {
        assert.doesNotMatch(source, new RegExp(`\\.${method}\\s*\\(`), `${name}: .${method}( 호출`);
      }
      for (const word of ['runTransaction', 'bulkWriter', 'recursiveDelete', 'BulkWriter', 'WriteBatch']) {
        assert.ok(!source.includes(word), `${name}: ${word}`);
      }
    });

    test(`${name}에 금지 필드 이름이 문자열로 들어 있지 않다`, async () => {
      const source = await readSource(name);
      for (const field of FORBIDDEN_FIELDS) {
        assert.doesNotMatch(source, new RegExp(`['"\`]${field.replace('.', '\\.')}['"\`]`), `${name}: '${field}'`);
      }
    });
  }

  test('수집기는 다른 열쇠 경로(GOOGLE_APPLICATION_CREDENTIALS·Admin 키 파일·applicationDefault)로 넘어가지 않는다', async () => {
    const source = await readSource('morning-check.mjs');
    assert.ok(!source.includes('applicationDefault'), 'applicationDefault 사용');
    assert.ok(!/env\??\.\s*GOOGLE_APPLICATION_CREDENTIALS|env\[['"]GOOGLE_APPLICATION_CREDENTIALS/.test(source), 'GOOGLE_APPLICATION_CREDENTIALS 읽기');
    assert.ok(!source.includes('apps/api/'), 'apps/api 경로 참조');
    assert.equal(ADMIN_KEY_BASENAME, 'firebase-adminsdk.json');
  });

  test('허용 목록에 금지 필드나 이름·전화·이메일·주소 필드가 없다(가게·회차 name만 허용)', () => {
    for (const [collection, fields] of Object.entries(FIELD_ALLOWLIST)) {
      for (const field of fields) {
        assert.ok(!FORBIDDEN_FIELDS.includes(field), `${collection}.${field}`);
        assert.doesNotMatch(field, /phone|email|address|note|message|ip$/i, `${collection}.${field}`);
        if (/name/i.test(field)) {
          assert.ok(field === 'name' && ['stores', 'saleRounds'].includes(collection), `${collection}.${field}`);
        }
      }
    }
  });
});

// ── 차단 장치 ────────────────────────────────────────────────────────────────

describe('열쇠 차단 장치(§4-2)', () => {
  const files = { [KEY_PATH]: validKey(), [CONFIG_PATH]: validConfig() };

  test('환경 변수 경로의 열쇠가 config 이메일·운영 프로젝트와 맞으면 통과', async () => {
    const { readText, reads } = fakeReader(files);
    const result = await loadReadonlyCredentials({ env: { [KEY_ENV]: KEY_PATH }, readText, configPath: CONFIG_PATH });
    assert.equal(result.key.client_email, OPS_EMAIL);
    assert.equal(result.keyCreatedAt, '2026-10-21');
    assert.deepEqual(reads.sort(), [CONFIG_PATH, KEY_PATH].sort());
  });

  test('환경 변수가 없으면 다른 열쇠(GOOGLE_APPLICATION_CREDENTIALS·Admin 키)를 찾지 않고 멈춘다', async () => {
    const { readText, reads } = fakeReader({ ...files, '/repo/apps/api/firebase-adminsdk.json': validKey() });
    await assert.rejects(
      loadReadonlyCredentials({ env: { GOOGLE_APPLICATION_CREDENTIALS: '/repo/apps/api/firebase-adminsdk.json' }, readText, configPath: CONFIG_PATH }),
      (error) => error instanceof OpsCheckStop && error.code === 'key-path-missing',
    );
    assert.deepEqual(reads, []);
  });

  test('경로가 Admin 키 파일 이름이면 읽지 않고 멈춘다', async () => {
    const { readText, reads } = fakeReader(files);
    await assert.rejects(
      loadReadonlyCredentials({ env: { [KEY_ENV]: 'C:\\repo\\apps\\api\\Firebase-AdminSDK.json' }, readText, configPath: CONFIG_PATH }),
      (error) => error.code === 'admin-key-path',
    );
    assert.deepEqual(reads, []);
  });

  test('열쇠의 client_email이 config 이메일과 다르면 멈추고, 메시지에 이메일을 넣지 않는다', async () => {
    const { readText } = fakeReader({ ...files, [KEY_PATH]: validKey({ client_email: 'firebase-adminsdk-x@fixture.example.test' }) });
    await assert.rejects(
      loadReadonlyCredentials({ env: { [KEY_ENV]: KEY_PATH }, readText, configPath: CONFIG_PATH }),
      (error) => error.code === 'key-email-mismatch' && !error.message.includes('@'),
    );
  });

  test('config가 없거나 이메일이 비어 있으면 멈춘다', async () => {
    await assert.rejects(
      loadReadonlyCredentials({ env: { [KEY_ENV]: KEY_PATH }, readText: fakeReader({ [KEY_PATH]: validKey() }).readText, configPath: CONFIG_PATH }),
      (error) => error.code === 'config-unreadable',
    );
    await assert.rejects(
      loadReadonlyCredentials({ env: { [KEY_ENV]: KEY_PATH }, readText: fakeReader({ ...files, [CONFIG_PATH]: validConfig({ serviceAccountEmail: ' ' }) }).readText, configPath: CONFIG_PATH }),
      (error) => error.code === 'config-email-missing',
    );
  });

  test('운영이 아닌 프로젝트 열쇠나 서비스 계정이 아닌 파일은 멈춘다', async () => {
    await assert.rejects(
      loadReadonlyCredentials({ env: { [KEY_ENV]: KEY_PATH }, readText: fakeReader({ ...files, [KEY_PATH]: validKey({ project_id: 'other-project' }) }).readText, configPath: CONFIG_PATH }),
      (error) => error.code === 'key-project-mismatch',
    );
    await assert.rejects(
      loadReadonlyCredentials({ env: { [KEY_ENV]: KEY_PATH }, readText: fakeReader({ ...files, [KEY_PATH]: '{"type":"authorized_user"}' }).readText, configPath: CONFIG_PATH }),
      (error) => error.code === 'key-malformed',
    );
  });
});

// ── 수집 ─────────────────────────────────────────────────────────────────────

describe('수집기(가짜 Firestore)', () => {
  test('모든 조회가 select/fieldMask를 쓰고, 필드는 허용 목록 안이며 금지 필드가 없다', async () => {
    const db = createFakeDb(seedData());
    await collect(db, { now: NOW });
    assert.ok(db.calls.length >= 12, `조회 수 ${db.calls.length}`);
    for (const call of db.calls) {
      const allowed = FIELD_ALLOWLIST[call.collection];
      assert.ok(allowed, `허용 목록 없는 컬렉션 ${call.collection}`);
      assert.ok(call.fields.length > 0, `${call.collection} 빈 select`);
      for (const field of call.fields) {
        assert.ok(allowed.includes(field), `${call.collection}.${field}`);
        assert.ok(!FORBIDDEN_FIELDS.includes(field), `${call.collection}.${field}`);
      }
    }
    const collections = [...new Set(db.calls.map((call) => call.collection))].sort();
    assert.deepEqual(collections, [
      'auditLogs',
      'invites',
      'operationIssues',
      'orders',
      'payments',
      'saleRounds',
      'settlements',
      'stores',
      'users',
    ]);
  });

  test('조건은 필드 하나짜리 등호·범위·in뿐이다(복합 인덱스 불필요)', async () => {
    const db = createFakeDb(seedData());
    await collect(db, { now: NOW });
    for (const call of db.calls.filter((c) => c.kind === 'query')) {
      const fields = [...new Set(call.filters.map((f) => f.field))];
      assert.ok(fields.length <= 1, `${call.collection}: ${fields.join(',')}`);
    }
  });

  test('수집 결과와 판정 보고에 손님 정보 표식이 없다', async () => {
    const { report } = await run({
      env: { [KEY_ENV]: KEY_PATH },
      now: NOW,
      readText: fakeReader({ [KEY_PATH]: validKey(), [CONFIG_PATH]: validConfig() }).readText,
      openFirestore: async () => createFakeDb(seedData()),
      fs: createMemoryFs(),
      reportsDir: '/reports',
      configPath: CONFIG_PATH,
      emit: () => {},
    });
    const text = JSON.stringify(report);
    for (const marker of [...PII_MARKERS, 'user-secret-id', 'owner-secret', 'admin-secret', '203.0.113.9', OPS_EMAIL, 'secret-id']) {
      assert.ok(!text.includes(marker), `보고에 ${marker}`);
    }
  });

  test('Firestore가 select를 무시하고 문서 전체를 보내도 보고에는 손님 정보가 섞이지 않는다', async () => {
    const { report } = await run({
      env: { [KEY_ENV]: KEY_PATH },
      now: NOW,
      readText: fakeReader({ [KEY_PATH]: validKey(), [CONFIG_PATH]: validConfig() }).readText,
      openFirestore: async () => createFakeDb(seedData(), { ignoreProjection: true }),
      fs: createMemoryFs(),
      reportsDir: '/reports',
      configPath: CONFIG_PATH,
      emit: () => {},
    });
    const text = JSON.stringify(report);
    for (const marker of [...PII_MARKERS, 'user-secret-id', 'owner-secret', 'admin-secret', '203.0.113.9']) {
      assert.ok(!text.includes(marker), `보고에 ${marker}`);
    }
  });

  test('기준마다 심어 둔 이상을 찾는다', async () => {
    const fs = createMemoryFs();
    const lines = [];
    const { report, exitCode } = await run({
      env: { [KEY_ENV]: KEY_PATH },
      now: NOW,
      readText: fakeReader({ [KEY_PATH]: validKey(), [CONFIG_PATH]: validConfig() }).readText,
      openFirestore: async () => createFakeDb(seedData()),
      fs,
      reportsDir: '/reports',
      configPath: CONFIG_PATH,
      emit: (text) => lines.push(text),
    });
    assert.equal(exitCode, 0);
    const levels = Object.fromEntries(report.items.map((item) => [item.id, item.level]));
    assert.deepEqual(levels, {
      S0: '🟢',
      M1: '🔴',
      M2: '🟡',
      O1: '🔴',
      O2: '🟡',
      O3: '🟡',
      O4: '🟡',
      P1: '🟡',
      P2: '🟡',
      S1: '🔴',
      S2: '🟢',
      S3: '🔴',
    });
    const o1 = report.items.find((item) => item.id === 'O1');
    assert.deepEqual(o1.entries.map((e) => e.orderNumber).sort(), ['20261019-000003', '20261021-000015']);
    assert.equal(report.overall, '🔴');
    // stdout JSON과 저장 파일이 같은 보고다.
    assert.deepEqual(JSON.parse(lines.join('\n')), report);
    assert.deepEqual(JSON.parse(fs.files['/reports/2026-10-22.json']), report);
  });

  test('한 출처 읽기가 실패해도 나머지는 읽고, 실패는 S0 🔴과 확인 못 함으로 남긴다(오류 원문 없음)', async () => {
    const { report, exitCode } = await run({
      env: { [KEY_ENV]: KEY_PATH },
      now: NOW,
      readText: fakeReader({ [KEY_PATH]: validKey(), [CONFIG_PATH]: validConfig() }).readText,
      openFirestore: async () => createFakeDb(seedData(), { failCollections: ['auditLogs'] }),
      fs: createMemoryFs(),
      reportsDir: '/reports',
      configPath: CONFIG_PATH,
      emit: () => {},
    });
    assert.equal(exitCode, 1);
    const s0 = report.items.find((item) => item.id === 'S0');
    assert.equal(s0.level, '🔴');
    assert.match(s0.entries[0].note, /auditLogs 읽기 실패: permission-denied/);
    assert.equal(report.items.find((item) => item.id === 'S1').checked, false);
    assert.equal(report.items.find((item) => item.id === 'M1').level, '🔴');
    assert.ok(!JSON.stringify(report).includes('secret-id'));
  });
});

// ── 실행 ─────────────────────────────────────────────────────────────────────

describe('실행(run)', () => {
  test('이메일이 다르면 Firestore에 연결하지 않고 S0 🔴 보고를 내며 종료 코드 1', async () => {
    let opened = false;
    const lines = [];
    const { report, exitCode } = await run({
      env: { [KEY_ENV]: KEY_PATH },
      now: NOW,
      readText: fakeReader({ [KEY_PATH]: validKey({ client_email: 'other@fixture.example.test' }), [CONFIG_PATH]: validConfig() }).readText,
      openFirestore: async () => {
        opened = true;
        return createFakeDb({});
      },
      fs: createMemoryFs(),
      reportsDir: '/reports',
      configPath: CONFIG_PATH,
      emit: (text) => lines.push(text),
    });
    assert.equal(opened, false);
    assert.equal(exitCode, 1);
    assert.equal(report.overall, '🔴');
    assert.deepEqual(report.items.map((item) => item.id), ['S0']);
    assert.equal(report.items[0].entries[0].key, 'stop|key-email-mismatch');
    const out = lines.join('\n');
    assert.ok(!out.includes('other@fixture'));
    assert.ok(!out.includes(OPS_EMAIL));
  });

  test('열쇠 경로 환경 변수가 없으면 열쇠·설정 파일을 읽지 않고 멈춘다', async () => {
    const reader = fakeReader({});
    let opened = false;
    const { exitCode, report } = await run({
      env: {},
      now: NOW,
      readText: reader.readText,
      openFirestore: async () => {
        opened = true;
      },
      fs: createMemoryFs(),
      reportsDir: '/reports',
      configPath: CONFIG_PATH,
      emit: () => {},
    });
    assert.equal(exitCode, 1);
    assert.equal(opened, false);
    assert.deepEqual(reader.reads, []);
    assert.equal(report.items[0].entries[0].key, 'stop|key-path-missing');
  });

  test('보고 파일 저장에 실패해도 JSON은 낸다', async () => {
    const fs = createMemoryFs();
    fs.writeFile = async () => {
      throw Object.assign(new Error('디스크 가득'), { code: 'ENOSPC' });
    };
    const lines = [];
    const { report } = await run({
      env: { [KEY_ENV]: KEY_PATH },
      now: NOW,
      readText: fakeReader({ [KEY_PATH]: validKey(), [CONFIG_PATH]: validConfig() }).readText,
      openFirestore: async () => createFakeDb({}),
      fs,
      reportsDir: '/reports',
      configPath: CONFIG_PATH,
      emit: (text) => lines.push(text),
    });
    assert.equal(report.saveError, '보고 파일 저장 실패: ENOSPC');
    assert.equal(JSON.parse(lines.join('\n')).overall, '🟢');
  });
});
