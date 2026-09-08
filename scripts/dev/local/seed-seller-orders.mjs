/**
 * Seller /orders Slice — 최소 deterministic seed/reset (FE-PILOT-L02-S).
 *
 * 범위: localhost Firestore emulator(`greenhub-local`)의 Seller Slice 문서만 다룬다.
 * - 전체 제품 demo seed가 아니다.
 * - production collection에 접근하지 않는다 (fail-closed).
 * - 실패 응답 자체를 Firestore seed로 억지 표현하지 않는다.
 *   read-failure 검증은 API/local harness의 safe test mechanism을 사용한다.
 *
 * Seller local auth 재사용:
 * - API `POST /auth/register`(seller invite) + `POST /auth/login` 실경로를 사용한다.
 * - 비밀번호 해시를 직접 쓰지 않는다 (API가 bcrypt로 생성).
 * - NextAuth/E2E_TEST_SECRET 우회가 아니다.
 *
 * 사용:
 *   GREENHUB_LOCAL_RUNTIME=true NODE_ENV=development \
 *   GREENHUB_SCHEDULES_ENABLED=false FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_PROJECT_ID=greenhub-local \
 *   FIREBASE_STORAGE_BUCKET=greenhub-local.appspot.com \
 *   node scripts/dev/local/seed-seller-orders.mjs --scenario=S-EMPTY
 *
 * 시나리오: S-EMPTY | S-ACTION | S-HELD | S-MIXED | S-FRESHNESS
 *   --reset  시나리오 문서 적용 전 해당 store의 기존 local 주문을 삭제한다.
 *   --list   시나리오 목록만 출력한다 (emulator 불필요).
 * 문서 쓰기는 upsert(POST 후 409면 전 필드 PATCH)이므로 반복 실행해도 같은 상태로 수렴한다.
 * seed는 seller와 store를 연결한다 (`users/{seller}.storeId = local-store-01`).
 * 연결이 없으면 Seller proxy가 `/orders` 대신 `/onboarding`으로 보낸다.
 */

import { fileURLToPath } from 'node:url';

const LOCAL_PROJECT_ID = 'greenhub-local';
const LOCAL_FIRESTORE_HOST = '127.0.0.1:8080';
const LOCAL_AUTH_HOST = '127.0.0.1:9099';
const LOCAL_API_BASE_URL = 'http://localhost:3000';

const PRODUCTION_PROJECT_IDS = new Set(['green-e4fe3']);
const PRODUCTION_API_MARKERS = ['railway.app', 'vercel.app', 'green-e4fe3'];

export const LOCAL_SELLER = Object.freeze({
  email: 'local-seller@greenhub.local',
  password: 'LocalSeller01!',
  name: '로컬 판매자',
  userId: 'local-seller-01',
  storeId: 'local-store-01',
  storeName: '로컬 테스트 상점',
  inviteId: 'local-seller-invite-01',
});

export const SCENARIOS = Object.freeze([
  'S-EMPTY',
  'S-ACTION',
  'S-HELD',
  'S-MIXED',
  'S-FRESHNESS',
]);

export class LocalSeedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocalSeedError';
  }
}

function readEnv(env, key) {
  const value = env?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function assertLocalSeedEnvironment(env = process.env) {
  if (readEnv(env, 'GREENHUB_LOCAL_RUNTIME') !== 'true') {
    throw new LocalSeedError('seed는 GREENHUB_LOCAL_RUNTIME=true에서만 실행할 수 있습니다.');
  }
  if (readEnv(env, 'NODE_ENV') !== 'development') {
    throw new LocalSeedError('seed는 NODE_ENV=development에서만 실행할 수 있습니다.');
  }
  if (['NODE_ENV', 'VERCEL_ENV', 'RAILWAY_ENVIRONMENT_NAME'].some((k) => readEnv(env, k) === 'production')) {
    throw new LocalSeedError('production marker가 있는 환경에서는 seed를 거부합니다.');
  }
  if (readEnv(env, 'GREENHUB_SCHEDULES_ENABLED') !== 'false') {
    throw new LocalSeedError('seed는 GREENHUB_SCHEDULES_ENABLED=false에서만 실행할 수 있습니다.');
  }
  if (readEnv(env, 'FIRESTORE_EMULATOR_HOST') !== LOCAL_FIRESTORE_HOST) {
    throw new LocalSeedError('seed는 127.0.0.1:8080 Firestore emulator에만 연결합니다.');
  }
  if (readEnv(env, 'FIREBASE_AUTH_EMULATOR_HOST') !== LOCAL_AUTH_HOST) {
    throw new LocalSeedError('seed는 127.0.0.1:9099 Auth emulator authority를 요구합니다.');
  }
  const projectId = readEnv(env, 'FIREBASE_PROJECT_ID');
  if (projectId !== LOCAL_PROJECT_ID) {
    throw new LocalSeedError('seed는 greenhub-local project에만 쓸 수 있습니다.');
  }
  if (PRODUCTION_PROJECT_IDS.has(projectId)) {
    throw new LocalSeedError('production Firebase project에는 seed를 쓰지 않습니다.');
  }
  if (readEnv(env, 'GOOGLE_APPLICATION_CREDENTIALS') || readEnv(env, 'FIREBASE_SERVICE_ACCOUNT_JSON')) {
    throw new LocalSeedError('seed는 service-account credential binding을 거부합니다.');
  }
  const apiUrl = readEnv(env, 'NEXT_PUBLIC_API_URL') || LOCAL_API_BASE_URL;
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(apiUrl)) {
    throw new LocalSeedError('seed의 API authority는 localhost 전용입니다.');
  }
  if (PRODUCTION_API_MARKERS.some((m) => apiUrl.includes(m))) {
    throw new LocalSeedError('remote API marker가 있는 URL로는 seed를 거부합니다.');
  }
  return {
    projectId: LOCAL_PROJECT_ID,
    firestoreHost: LOCAL_FIRESTORE_HOST,
    authHost: LOCAL_AUTH_HOST,
    apiBaseUrl: apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1') ? apiUrl : LOCAL_API_BASE_URL,
  };
}

export function firestoreBaseUrl() {
  return `http://${LOCAL_FIRESTORE_HOST}/v1/projects/${LOCAL_PROJECT_ID}/databases/(default)/documents`;
}

function isoDate(offsetDays, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function baseOrder({ orderId, status, offsetDays, extra = {} }) {
  const now = new Date().toISOString();
  return {
    id: orderId,
    storeId: LOCAL_SELLER.storeId,
    userId: 'local-consumer-01',
    orderNumber: orderId.toUpperCase().replaceAll('_', '-'),
    productId: 'local-product-01',
    productName: '로컬 테스트 상품',
    quantity: 1,
    saleType: 'normal',
    status,
    deliveryMethod: 'direct',
    deliveryFee: 0,
    totalAmount: 15000,
    requestedDeliveryDate: isoDate(offsetDays),
    createdAt: isoDate(Math.min(offsetDays, 0)),
    updatedAt: now,
    orderItems: [
      {
        productId: 'local-product-01',
        productName: '로컬 테스트 상품',
        quantity: 1,
        unitPrice: 15000,
        subtotalAmount: 15000,
      },
    ],
    ...extra,
  };
}

/**
 * 시나리오별 deterministic 주문 세트.
 * - S-EMPTY: 0건 (정상 조회 + EmptyState)
 * - S-ACTION: 처리 필요 주문 존재 (PENDING/ACCEPTED/CONFIRMED)
 * - S-HELD: DELIVERY_HELD 운영 예외 표시 대상
 * - S-MIXED: 날짜/상태 필터 검증용 복수 주문
 * - S-FRESHNESS: 초기 read 후 emulator 변경 → revalidation 확인용 단일 기준 주문
 */
export function buildScenarioDocs(scenario) {
  switch (scenario) {
    case 'S-EMPTY':
      return [];
    case 'S-ACTION':
      return [
        baseOrder({ orderId: 'local-order-action-01', status: 'PENDING', offsetDays: 1 }),
        baseOrder({ orderId: 'local-order-action-02', status: 'ACCEPTED', offsetDays: 2 }),
      ];
    case 'S-HELD':
      return [
        baseOrder({
          orderId: 'local-order-held-01',
          status: 'DELIVERY_HELD',
          offsetDays: 1,
          extra: {
            deliveryHold: {
              heldAt: isoDate(0),
              reasonCode: 'WEATHER',
              reasonMessage: '폭우로 인한 배송 보류',
              customerResponsible: false,
              redeliveryFee: 0,
            },
          },
        }),
      ];
    case 'S-MIXED':
      return [
        baseOrder({ orderId: 'local-order-mixed-01', status: 'PENDING', offsetDays: -1 }),
        baseOrder({ orderId: 'local-order-mixed-02', status: 'PREPARING', offsetDays: 0 }),
        baseOrder({ orderId: 'local-order-mixed-03', status: 'DELIVERING', offsetDays: 1 }),
        baseOrder({
          orderId: 'local-order-mixed-04',
          status: 'DELIVERY_HELD',
          offsetDays: 2,
          extra: {
            deliveryHold: {
              heldAt: isoDate(0),
              reasonCode: 'ABSENT',
              reasonMessage: '부재중',
              customerResponsible: true,
              redeliveryFee: 3000,
            },
          },
        }),
        baseOrder({ orderId: 'local-order-mixed-05', status: 'DELIVERED', offsetDays: -3 }),
      ];
    case 'S-FRESHNESS':
      return [
        baseOrder({ orderId: 'local-order-fresh-01', status: 'PENDING', offsetDays: 1 }),
      ];
    default:
      throw new LocalSeedError(`알 수 없는 시나리오: ${scenario}. (${SCENARIOS.join(', ')})`);
  }
}

export function freshnessMutationDoc(existing) {
  return {
    ...existing,
    status: 'PREPARING',
    updatedAt: new Date().toISOString(),
  };
}

// ── Firestore emulator REST helpers ──────────────────────────────────────────

export function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function toFirestoreFields(doc) {
  const fields = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'id') continue;
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

async function restJson(url, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LocalSeedError(`emulator REST 실패: ${method} ${url} → ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 200 && (res.headers.get('content-type') ?? '').includes('application/json')) {
    return res.json();
  }
  return undefined;
}

export async function listLocalStoreOrders({ fetchImpl = fetch } = {}) {
  const url = `${firestoreBaseUrl()}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'orders' }],
      where: { fieldFilter: { field: { fieldPath: 'storeId' }, op: 'EQUAL', value: { stringValue: LOCAL_SELLER.storeId } } },
    },
  };
  const rows = (await restJson(url, { method: 'POST', body, fetchImpl })) ?? [];
  return rows
    .map((r) => r?.document?.name?.split('/').pop())
    .filter(Boolean);
}

export async function deleteDocs(collection, ids, { fetchImpl = fetch } = {}) {
  for (const id of ids) {
    await restJson(`${firestoreBaseUrl()}/${collection}/${id}`, { method: 'DELETE', fetchImpl });
  }
  return ids.length;
}

export async function writeDoc(collection, id, doc, { fetchImpl = fetch } = {}) {
  try {
    await restJson(`${firestoreBaseUrl()}/${collection}?documentId=${encodeURIComponent(id)}`, {
      method: 'POST',
      body: toFirestoreFields(doc),
      fetchImpl,
    });
  } catch (error) {
    // 재실행 결정성: 이미 있으면 전 필드 PATCH로 같은 상태로 복원한다.
    if (error instanceof LocalSeedError && /(^|\s)409\b|ALREADY_EXISTS/i.test(error.message)) {
      await patchDoc(collection, id, doc, { fetchImpl });
      return id;
    }
    throw error;
  }
  return id;
}

export async function patchDoc(collection, id, fields, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams();
  for (const key of Object.keys(fields)) params.append('updateMask.fieldPaths', key);
  await restJson(`${firestoreBaseUrl()}/${collection}/${id}?${params}`, {
    method: 'PATCH',
    body: toFirestoreFields(fields),
    fetchImpl,
  });
  return id;
}

export async function applyScenario(scenario, { reset = true, fetchImpl = fetch, apiFetchImpl = fetch, env = process.env } = {}) {
  const runtime = assertLocalSeedEnvironment(env);
  if (!SCENARIOS.includes(scenario)) {
    throw new LocalSeedError(`알 수 없는 시나리오: ${scenario}`);
  }
  // 1. invite upsert (seller register 실경로 재사용)
  const invite = {
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    usedAt: null,
    maxUses: 50,
    note: 'FE-PILOT-L02-S local harness',
  };
  await writeDoc('invites', LOCAL_SELLER.inviteId, invite, { fetchImpl });

  // 2. seller register → 이미 있으면 login (API 실경로, 비밀번호 해시 직접 쓰기 없음)
  const registerRes = await apiFetchImpl(`${runtime.apiBaseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: LOCAL_SELLER.email,
      password: LOCAL_SELLER.password,
      name: LOCAL_SELLER.name,
      role: 'seller',
      inviteToken: LOCAL_SELLER.inviteId,
    }),
  });
  let sellerId = LOCAL_SELLER.userId;
  if (registerRes.status === 409) {
    const loginRes = await apiFetchImpl(`${runtime.apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOCAL_SELLER.email, password: LOCAL_SELLER.password }),
    });
    if (!loginRes.ok) throw new LocalSeedError(`local seller login 실패: ${loginRes.status}`);
    const login = await loginRes.json();
    sellerId = login?.user?.id ?? sellerId;
  } else if (!registerRes.ok) {
    throw new LocalSeedError(`local seller register 실패: ${registerRes.status}`);
  } else {
    const registered = await registerRes.json().catch(() => ({}));
    sellerId = registered?.userId ?? sellerId;
  }

  // 3. store upsert (owner = local seller)
  await writeDoc('stores', LOCAL_SELLER.storeId, {
    id: LOCAL_SELLER.storeId,
    ownerId: sellerId,
    name: LOCAL_SELLER.storeName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { fetchImpl });

  // 3b. seller ↔ store 연결 (proxy /orders 진입 + API owner 검사에 필요).
  // register는 storeId=null로 생성하므로 seed에서 명시적으로 연결한다.
  await patchDoc('users', sellerId, { storeId: LOCAL_SELLER.storeId }, { fetchImpl });

  // 4. reset: 기존 local store 주문 삭제 → deterministic 복원
  let removed = 0;
  if (reset) {
    const existing = await listLocalStoreOrders({ fetchImpl });
    removed = await deleteDocs('orders', existing, { fetchImpl });
  }

  // 5. scenario docs 적용
  const docs = buildScenarioDocs(scenario);
  for (const doc of docs) {
    await writeDoc('orders', doc.id, doc, { fetchImpl });
  }
  return { scenario, applied: docs.length, removed, storeId: LOCAL_SELLER.storeId, sellerId };
}

function printUsage() {
  console.log('사용: node scripts/dev/local/seed-seller-orders.mjs --scenario=<S-EMPTY|S-ACTION|S-HELD|S-MIXED|S-FRESHNESS> [--reset|--no-reset] [--list]');
}

const invokedAsMain =
  typeof process.argv[1] === 'string' &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log(SCENARIOS.join('\n'));
  } else {
    const scenarioArg = args.find((a) => a.startsWith('--scenario='));
    const scenario = scenarioArg ? scenarioArg.split('=')[1] : undefined;
    const reset = !args.includes('--no-reset');
    if (!scenario) {
      printUsage();
      process.exitCode = 2;
    } else {
      applyScenario(scenario, { reset })
        .then((r) => console.log(JSON.stringify(r)))
        .catch((e) => {
          console.error(`[seed-seller-orders] 실패: ${e?.message ?? e}`);
          process.exitCode = 1;
        });
    }
  }
}
