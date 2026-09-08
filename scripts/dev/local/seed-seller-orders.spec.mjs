import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_SELLER,
  SCENARIOS,
  applyScenario,
  assertLocalSeedEnvironment,
  buildScenarioDocs,
  freshnessMutationDoc,
  toFirestoreFields,
} from './seed-seller-orders.mjs';

const LOCAL_ENV = Object.freeze({
  GREENHUB_LOCAL_RUNTIME: 'true',
  NODE_ENV: 'development',
  GREENHUB_SCHEDULES_ENABLED: 'false',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_PROJECT_ID: 'greenhub-local',
  FIREBASE_STORAGE_BUCKET: 'greenhub-local.appspot.com',
  NEXT_PUBLIC_API_URL: 'http://localhost:3000',
});

test('seed env: local 구성을 승인한다', () => {
  const runtime = assertLocalSeedEnvironment({ ...LOCAL_ENV });
  assert.equal(runtime.projectId, 'greenhub-local');
  assert.equal(runtime.apiBaseUrl, 'http://localhost:3000');
});

test('seed env: production identity/marker를 거부한다', () => {
  assert.throws(
    () => assertLocalSeedEnvironment({ ...LOCAL_ENV, FIREBASE_PROJECT_ID: 'green-e4fe3' }),
    /greenhub-local/,
  );
  assert.throws(
    () => assertLocalSeedEnvironment({ ...LOCAL_ENV, NODE_ENV: 'production' }),
    /development/,
  );
  assert.throws(
    () => assertLocalSeedEnvironment({ ...LOCAL_ENV, RAILWAY_ENVIRONMENT_NAME: 'production' }),
    /production marker/,
  );
  assert.throws(
    () => assertLocalSeedEnvironment({ ...LOCAL_ENV, GREENHUB_LOCAL_RUNTIME: '' }),
    /GREENHUB_LOCAL_RUNTIME/,
  );
});

test('seed env: emulator authority/service-account/remote API를 거부한다', () => {
  assert.throws(
    () => assertLocalSeedEnvironment({ ...LOCAL_ENV, FIRESTORE_EMULATOR_HOST: '192.168.0.10:8080' }),
    /emulator/,
  );
  assert.throws(
    () => assertLocalSeedEnvironment({ ...LOCAL_ENV, FIREBASE_AUTH_EMULATOR_HOST: '' }),
    /Auth emulator/,
  );
  assert.throws(
    () =>
      assertLocalSeedEnvironment({
        ...LOCAL_ENV,
        FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}',
      }),
    /service-account/,
  );
  assert.throws(
    () =>
      assertLocalSeedEnvironment({
        ...LOCAL_ENV,
        NEXT_PUBLIC_API_URL: 'https://api-production-13e7.up.railway.app',
      }),
    /localhost/,
  );
});

test('시나리오 세트는 deterministic하고 slice 범위를 벗어나지 않는다', () => {
  assert.deepEqual([...SCENARIOS], ['S-EMPTY', 'S-ACTION', 'S-HELD', 'S-MIXED', 'S-FRESHNESS']);
  assert.equal(buildScenarioDocs('S-EMPTY').length, 0);
  const action = buildScenarioDocs('S-ACTION');
  assert.ok(action.length >= 1);
  assert.ok(action.every((d) => d.storeId === LOCAL_SELLER.storeId));
  assert.ok(new Set(action.map((d) => d.status)).has('PENDING'));
  const held = buildScenarioDocs('S-HELD');
  assert.equal(held.length, 1);
  assert.equal(held[0].status, 'DELIVERY_HELD');
  assert.ok(held[0].deliveryHold);
  const mixed = buildScenarioDocs('S-MIXED');
  assert.ok(mixed.length >= 4);
  assert.ok(new Set(mixed.map((d) => d.status)).has('DELIVERY_HELD'));
  const fresh = buildScenarioDocs('S-FRESHNESS');
  assert.equal(fresh.length, 1);
  const mutated = freshnessMutationDoc(fresh[0]);
  assert.equal(mutated.id, fresh[0].id);
  assert.notEqual(mutated.status, fresh[0].status);
  assert.equal(mutated.storeId, LOCAL_SELLER.storeId);
  // reset 결정성: 같은 시나리오를 두 번 만들면 id/status 세트가 같다
  const again = buildScenarioDocs('S-MIXED');
  assert.deepEqual(
    mixed.map((d) => [d.id, d.status]),
    again.map((d) => [d.id, d.status]),
  );
  assert.throws(() => buildScenarioDocs('S-UNKNOWN'), /알 수 없는 시나리오/);
});

test('Firestore REST 인코딩은 emulator 문서 형식을 따른다', () => {
  const fields = toFirestoreFields({ id: 'skip-me', storeId: 's', quantity: 2, flag: true, nothing: null });
  assert.ok(!('id' in fields.fields));
  assert.equal(fields.fields.storeId.stringValue, 's');
  assert.equal(fields.fields.quantity.integerValue, '2');
  assert.equal(fields.fields.flag.booleanValue, true);
  assert.ok('nullValue' in fields.fields.nothing);
});

test('applyScenario: reset 시 기존 local 주문을 지우고 시나리오를 적용한다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    if (url.endsWith(':runQuery')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [
          { document: { name: 'projects/x/databases/(default)/documents/orders/old-1' } },
          { document: { name: 'projects/x/databases/(default)/documents/orders/old-2' } },
        ],
      };
    }
    if (url.includes('/auth/register')) {
      return { ok: true, status: 200, json: async () => ({ userId: 'local-seller-01' }) };
    }
    return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
  };
  const result = await applyScenario('S-HELD', {
    reset: true,
    fetchImpl,
    apiFetchImpl: fetchImpl,
    env: { ...LOCAL_ENV },
  });
  assert.equal(result.scenario, 'S-HELD');
  assert.equal(result.applied, 1);
  assert.equal(result.removed, 2);
  const deletes = calls.filter((c) => c.method === 'DELETE');
  assert.equal(deletes.length, 2);
  assert.ok(deletes.every((c) => c.url.includes('/orders/old-')));
  // production collection에 쓰지 않음: invites/stores/orders(local store)만 허용
  const writes = calls.filter((c) => c.method === 'POST' && c.url.includes('/documents/'));
  assert.ok(writes.length >= 3);
  assert.ok(
    writes.every((c) => c.url.includes('/invites') || c.url.includes('/stores') || c.url.includes('/orders')),
  );
});

test('applyScenario: register 409면 login 실경로로 seller를 확정한다', async () => {
  const apiCalls = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith(':runQuery')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
      };
    }
    return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
  };
  const apiFetchImpl = async (url, init) => {
    apiCalls.push(url);
    if (url.endsWith('/auth/register')) return { ok: false, status: 409 };
    if (url.endsWith('/auth/login')) {
      return { ok: true, status: 200, json: async () => ({ user: { id: 'local-seller-01' } }) };
    }
    throw new Error(`unexpected api call: ${url}`);
  };
  const result = await applyScenario('S-EMPTY', {
    reset: true,
    fetchImpl,
    apiFetchImpl,
    env: { ...LOCAL_ENV },
  });
  assert.equal(result.applied, 0);
  assert.deepEqual(apiCalls, [
    'http://localhost:3000/auth/register',
    'http://localhost:3000/auth/login',
  ]);
});

test('applyScenario: 기존 문서는 PATCH upsert로 복원하고 seller-store를 연결한다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    if (url.endsWith(':runQuery')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
      };
    }
    if (url.includes('/documents/invites') && (init?.method ?? 'GET') === 'POST') {
      return { ok: false, status: 409, text: async () => 'ALREADY_EXISTS' };
    }
    return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
  };
  const apiFetchImpl = async (url) => {
    if (url.endsWith('/auth/register')) {
      return { ok: true, status: 200, json: async () => ({ userId: 'local-seller-01' }) };
    }
    throw new Error(`unexpected api call: ${url}`);
  };
  const result = await applyScenario('S-EMPTY', {
    reset: true,
    fetchImpl,
    apiFetchImpl,
    env: { ...LOCAL_ENV },
  });
  assert.equal(result.applied, 0);
  const patches = calls.filter((c) => c.method === 'PATCH');
  assert.ok(patches.some((c) => c.url.includes('/invites/')));
  const link = patches.find((c) => c.url.includes('/users/local-seller-01'));
  assert.ok(link);
  assert.match(link.url, /updateMask\.fieldPaths=storeId/);
});
