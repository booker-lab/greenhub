import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRIVER_BOARD_ORDER_IDS,
  LOCAL_DRIVER,
  applyDriverSeed,
  buildDriverBoardDocs,
} from './seed-driver-board.mjs';
import { LOCAL_SELLER } from './seed-seller-orders.mjs';

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

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
  };
}

function emptyResponse() {
  return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
}

test('보드 문서 세트는 deterministic하고 driver 가시성 조건을 만족한다', () => {
  const docs = buildDriverBoardDocs('local-driver-01');
  assert.deepEqual(
    docs.map((d) => d.id),
    [...DRIVER_BOARD_ORDER_IDS],
  );
  assert.deepEqual(
    docs.map((d) => d.status),
    ['PREPARING', 'DELIVERING'],
  );
  assert.ok(docs.every((d) => d.storeId === LOCAL_SELLER.storeId));
  assert.ok(docs.every((d) => d.deliveryMethod === 'direct'));
  // 01: 미배정 discovery, 02: 담당 기사 assigned
  assert.ok(!('driverId' in docs[0]));
  assert.equal(docs[1].driverId, 'local-driver-01');
  // driver list 쿼리(orderBy preparedAt)에 필요한 필드가 있다
  assert.ok(docs.every((d) => typeof d.preparedAt === 'string'));
  // 두 번 만들면 같은 id/status 세트다
  assert.deepEqual(
    buildDriverBoardDocs('local-driver-01').map((d) => [d.id, d.status]),
    docs.map((d) => [d.id, d.status]),
  );
});

test('applyDriverSeed: register 성공 시 승인 후 login 실경로로 확정한다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    if (url.endsWith(`/stores/${LOCAL_SELLER.storeId}`)) return jsonResponse({ name: 'store' });
    if (url.endsWith(':runQuery')) return jsonResponse([]);
    return emptyResponse();
  };
  const apiCalls = [];
  const apiFetchImpl = async (url) => {
    apiCalls.push(url);
    if (url.endsWith('/auth/register')) {
      return { ok: true, status: 200, json: async () => ({ userId: 'local-driver-01' }) };
    }
    if (url.endsWith('/auth/login')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'local-driver-01', role: 'driver', driverApproved: true } }),
      };
    }
    throw new Error(`unexpected api call: ${url}`);
  };
  const result = await applyDriverSeed({
    reset: true,
    fetchImpl,
    apiFetchImpl,
    env: { ...LOCAL_ENV },
  });
  assert.equal(result.applied, 2);
  assert.equal(result.removed, 0);
  assert.equal(result.driverId, 'local-driver-01');
  assert.deepEqual(apiCalls, [
    'http://localhost:3000/auth/register',
    'http://localhost:3000/auth/login',
  ]);
  const patches = calls.filter((c) => c.method === 'PATCH');
  assert.ok(patches.some((c) => c.url.includes('/users/local-driver-01')));
  const writes = calls.filter((c) => c.method === 'POST' && c.url.includes('/documents/orders'));
  assert.equal(writes.length, 2);
});

test('applyDriverSeed: register 409면 email 조회 후 승인하고 seller slice는 지우지 않는다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    if (url.endsWith(`/stores/${LOCAL_SELLER.storeId}`)) return jsonResponse({ name: 'store' });
    if (url.endsWith(':runQuery')) {
      const body = JSON.parse(init.body);
      const collection = body?.structuredQuery?.from?.[0]?.collectionId;
      if (collection === 'users') {
        return jsonResponse([
          { document: { name: 'projects/x/databases/(default)/documents/users/existing-driver-9' } },
        ]);
      }
      return jsonResponse([
        { document: { name: 'projects/x/databases/(default)/documents/orders/local-order-driver-01' } },
        { document: { name: 'projects/x/databases/(default)/documents/orders/local-order-mixed-01' } },
      ]);
    }
    return emptyResponse();
  };
  const apiFetchImpl = async (url) => {
    if (url.endsWith('/auth/register')) return { ok: false, status: 409 };
    if (url.endsWith('/auth/login')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'existing-driver-9', role: 'driver', driverApproved: true } }),
      };
    }
    throw new Error(`unexpected api call: ${url}`);
  };
  const result = await applyDriverSeed({
    reset: true,
    fetchImpl,
    apiFetchImpl,
    env: { ...LOCAL_ENV },
  });
  assert.equal(result.driverId, 'existing-driver-9');
  assert.equal(result.removed, 1);
  const deletes = calls.filter((c) => c.method === 'DELETE');
  assert.equal(deletes.length, 1);
  assert.ok(deletes[0].url.includes('/orders/local-order-driver-01'));
});

test('applyDriverSeed: store가 없으면 seller seed를 먼저 요구하고 API를 호출하지 않는다', async () => {
  let apiCalled = false;
  const fetchImpl = async (url) => {
    if (url.includes('/documents/stores/')) return { ok: false, status: 404, text: async () => '' };
    return emptyResponse();
  };
  await assert.rejects(
    applyDriverSeed({
      fetchImpl,
      apiFetchImpl: async () => {
        apiCalled = true;
        throw new Error('must not call api');
      },
      env: { ...LOCAL_ENV },
    }),
    /seller seed를 먼저 실행/,
  );
  assert.equal(apiCalled, false);
});

test('local driver credential은 운영 계정과 겹치지 않는다', () => {
  assert.ok(LOCAL_DRIVER.email.endsWith('@greenhub.local'));
  assert.notEqual(LOCAL_DRIVER.email, LOCAL_SELLER.email);
});
