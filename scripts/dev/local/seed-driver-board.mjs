/**
 * Driver /board Slice — 최소 deterministic seed/reset (FE-PILOT-L02-MAIN-READY).
 *
 * 범위: localhost Firestore emulator(`greenhub-local`)의 Driver Slice 문서만 다룬다.
 * - Seller seed(`seed-seller-orders.mjs`)가 만든 `local-store-01`을 재사용한다.
 *   store가 없으면 생성하지 않고 실패한다 (seller seed를 먼저 실행).
 * - Seller slice 주문(`local-order-*`)은 건드리지 않는다.
 *   driver 문서 ID(`local-order-driver-*`)만 삭제 후 적용한다.
 * - production collection에 접근하지 않는다 (fail-closed: seller seed의 env 검사를 재사용).
 * - 비밀번호 해시를 직접 쓰지 않는다 (API `POST /auth/register` 실경로 사용).
 * - driver는 invite 없이 등록되며, seed가 `driverApproved=true`로 승인한다.
 *   미승인 driver는 API 로그인이 403이므로 승인 후 login 실경로로 검증한다.
 *
 * 사용:
 *   GREENHUB_LOCAL_RUNTIME=true NODE_ENV=development \
 *   GREENHUB_SCHEDULES_ENABLED=false FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_PROJECT_ID=greenhub-local \
 *   FIREBASE_STORAGE_BUCKET=greenhub-local.appspot.com \
 *   node scripts/dev/local/seed-driver-board.mjs [--reset|--no-reset]
 *
 * 보드 문서 (legacy scope: salesMode 없는 store + deliveryMethod direct):
 *   - local-order-driver-01: PREPARING, 미배정 (discovery 노출)
 *   - local-order-driver-02: DELIVERING, local driver에 배정 (assigned 노출)
 */

import { fileURLToPath } from 'node:url';
import {
  LOCAL_SELLER,
  LocalSeedError,
  assertLocalSeedEnvironment,
  deleteDocs,
  firestoreBaseUrl,
  listLocalStoreOrders,
  patchDoc,
  writeDoc,
} from './seed-seller-orders.mjs';

export const LOCAL_DRIVER = Object.freeze({
  email: 'local-driver@greenhub.local',
  password: 'LocalDriver01!',
  name: '로컬 드라이버',
  userId: 'local-driver-01',
});

export const DRIVER_BOARD_ORDER_IDS = Object.freeze([
  'local-order-driver-01',
  'local-order-driver-02',
]);

function isoNow() {
  return new Date().toISOString();
}

function baseDriverOrder({ orderId, status, driverId }) {
  const now = isoNow();
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
    buyerName: '로컬 고객',
    deliveryAddress: { address: '서울특별시 중구 로컬로 01' },
    requestedDeliveryDate: now,
    preparedAt: now,
    createdAt: now,
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
    ...(driverId ? { driverId } : {}),
  };
}

/**
 * Driver board deterministic 주문 세트.
 * - 01: PREPARING 미배정 → 승인된 driver의 discovery(board 수거 대기)에 노출.
 * - 02: DELIVERING + driver 배정 → 담당 driver의 assigned(board 배송 중)에 노출.
 */
export function buildDriverBoardDocs(driverId) {
  return [
    baseDriverOrder({ orderId: DRIVER_BOARD_ORDER_IDS[0], status: 'PREPARING' }),
    baseDriverOrder({ orderId: DRIVER_BOARD_ORDER_IDS[1], status: 'DELIVERING', driverId }),
  ];
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

export async function assertDriverStoreExists({ fetchImpl = fetch } = {}) {
  const url = `${firestoreBaseUrl()}/stores/${encodeURIComponent(LOCAL_SELLER.storeId)}`;
  const res = await fetchImpl(url, { method: 'GET' });
  if (res.status === 404) {
    throw new LocalSeedError(
      `store가 없습니다: ${LOCAL_SELLER.storeId}. seller seed를 먼저 실행하세요.`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LocalSeedError(`store 확인 실패: GET ${url} → ${res.status} ${text.slice(0, 200)}`);
  }
  return LOCAL_SELLER.storeId;
}

export async function findUserIdByEmail(email, { fetchImpl = fetch } = {}) {
  const rows =
    (await restJson(`${firestoreBaseUrl()}:runQuery`, {
      method: 'POST',
      body: {
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } },
          },
          limit: 1,
        },
      },
      fetchImpl,
    })) ?? [];
  const doc = rows[0]?.document;
  const byField = doc?.fields?.id?.stringValue;
  if (typeof byField === 'string' && byField) return byField;
  const byName = doc?.name?.split('/').pop();
  if (typeof byName === 'string' && byName) return byName;
  throw new LocalSeedError(`local driver 문서를 찾을 수 없습니다: ${email}`);
}

export async function ensureApprovedLocalDriver(
  apiBaseUrl,
  { apiFetchImpl = fetch, fetchImpl = fetch } = {},
) {
  const registerRes = await apiFetchImpl(`${apiBaseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: LOCAL_DRIVER.email,
      password: LOCAL_DRIVER.password,
      name: LOCAL_DRIVER.name,
      role: 'driver',
    }),
  });
  let driverId = LOCAL_DRIVER.userId;
  if (registerRes.status === 409) {
    driverId = await findUserIdByEmail(LOCAL_DRIVER.email, { fetchImpl });
  } else if (!registerRes.ok) {
    throw new LocalSeedError(`local driver register 실패: ${registerRes.status}`);
  } else {
    const registered = await registerRes.json().catch(() => ({}));
    driverId = registered?.userId ?? driverId;
  }

  await patchDoc('users', driverId, { driverApproved: true }, { fetchImpl });

  const loginRes = await apiFetchImpl(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOCAL_DRIVER.email, password: LOCAL_DRIVER.password }),
  });
  if (!loginRes.ok) throw new LocalSeedError(`local driver login 실패: ${loginRes.status}`);
  const login = await loginRes.json();
  if (login?.user?.role !== 'driver' || login?.user?.driverApproved !== true) {
    throw new LocalSeedError('local driver 승인 상태가 아닙니다.');
  }
  return { driverId, login };
}

export async function applyDriverSeed(
  { reset = true, fetchImpl = fetch, apiFetchImpl = fetch, env = process.env } = {},
) {
  const runtime = assertLocalSeedEnvironment(env);
  await assertDriverStoreExists({ fetchImpl });
  const { driverId } = await ensureApprovedLocalDriver(runtime.apiBaseUrl, {
    apiFetchImpl,
    fetchImpl,
  });

  let removed = 0;
  if (reset) {
    const existing = await listLocalStoreOrders({ fetchImpl });
    const driverDocs = existing.filter((id) => id.startsWith('local-order-driver-'));
    removed = await deleteDocs('orders', driverDocs, { fetchImpl });
  }

  const docs = buildDriverBoardDocs(driverId);
  for (const doc of docs) {
    await writeDoc('orders', doc.id, doc, { fetchImpl });
  }
  return { applied: docs.length, removed, storeId: LOCAL_SELLER.storeId, driverId };
}

const invokedAsMain =
  typeof process.argv[1] === 'string' &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const args = process.argv.slice(2);
  const reset = !args.includes('--no-reset');
  applyDriverSeed({ reset })
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(`[seed-driver-board] 실패: ${e?.message ?? e}`);
      process.exitCode = 1;
    });
}
