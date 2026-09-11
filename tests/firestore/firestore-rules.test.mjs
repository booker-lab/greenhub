import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-greenhub';
const SERVER_ONLY_COLLECTIONS = [
  'checkoutReservations',
  'operationIssues',
  'legalOrderRecords',
  'legalDisputeRecords',
  'marketingConsentLogs',
  'deliveryPhotoRecords',
  'notificationDeliveries',
];
const PUBLIC_ROUND_COLLECTIONS = ['saleRounds', 'saleRoundItems'];

let testEnvironment;

function emulatorConfig(rules) {
  const [host, rawPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  return {
    rules,
    host,
    port: Number(rawPort),
  };
}

function clientContexts() {
  return [
    ['인증 없음', testEnvironment.unauthenticatedContext().firestore()],
    ['일반 사용자', testEnvironment.authenticatedContext('user-1').firestore()],
    [
      '판매자',
      testEnvironment
        .authenticatedContext('seller-1', { role: 'seller', storeId: 'store-1' })
        .firestore(),
    ],
    [
      '승인 기사',
      testEnvironment
        .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
        .firestore(),
    ],
    [
      '미승인 기사',
      testEnvironment
        .authenticatedContext('pending-driver', { role: 'driver', driverApproved: false })
        .firestore(),
    ],
    ['관리자', testEnvironment.authenticatedContext('admin-1', { role: 'admin' }).firestore()],
  ];
}

async function seedFixtures() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const fixtures = {
      'products/product-1': {
        storeId: 'store-1',
        name: '공개 상품',
        isActive: true,
        sellerNote: '내부 메모',
        sellerOverride: true,
        content: { headline: '제목', description: '설명', isEditedByUser: true },
      },
      'products/product-inactive': { storeId: 'store-1', name: '비활성 상품', isActive: false },
      'products/product-testonly': {
        storeId: 'store-1',
        name: '테스트 상품',
        isActive: true,
        testOnly: true,
      },
      'products/product-store2': {
        storeId: 'store-2',
        name: '다른 매장 상품',
        isActive: true,
        sellerNote: 'store-2 내부 메모',
      },
      'stores/store-1': {
        name: '공개 매장',
        salesMode: 'round_direct',
        ownerId: 'seller-1',
        ceoName: '홍길동',
        phone: '010-1234-5678',
        address: '경기도 이천시',
        businessNumber: '123-45-67890',
        status: 'active',
      },
      'stores/store-2': {
        name: '다른 매장',
        salesMode: 'round_direct',
        ownerId: 'seller-2',
        ceoName: '김철수',
        phone: '010-9876-5432',
        address: '서울시 강남구',
        businessNumber: '987-65-43210',
        status: 'active',
      },
      'stores/store-legacy': { name: '기존 매장', salesMode: 'legacy' },
      'stores/store-missing-mode': { name: '모드 누락 매장' },
      'stores/store-null-mode': { name: 'null 모드 매장', salesMode: null },
      'stores/store-invalid-mode': { name: '잘못된 모드 매장', salesMode: 'unsupported' },
      'dailyCaps/store-1_2026-07-18': { storeId: 'store-1', date: '2026-07-18' },
      'groupProductConfig/product-1': {
        storeId: 'store-1',
        productId: 'product-1',
        currentQuantity: 3,
        isProcessed: true,
      },
      'groupProductConfig/product-store2': {
        storeId: 'store-2',
        productId: 'product-store2',
        currentQuantity: 5,
        isProcessed: false,
      },
      'varieties/variety-1': {
        name: '호접란',
        category: 'orchid',
        bloomDuration: '60~90일',
      },
      'orders/order-store-1': {
        storeId: 'store-1',
        userId: 'user-1',
        status: 'PREPARING',
        driverId: null,
        deliveryMethod: 'direct',
        preparedAt: '2026-08-23T08:00:00.000Z',
        updatedAt: '2026-08-23T08:00:00.000Z',
      },
      'orders/order-store-2': {
        storeId: 'store-2',
        userId: 'user-2',
        status: 'DELIVERING',
        driverId: 'driver-1',
        deliveryMethod: 'direct',
        preparedAt: '2026-08-23T07:00:00.000Z',
        updatedAt: '2026-08-23T09:00:00.000Z',
      },
      'orders/order-driver-other': {
        storeId: 'store-1',
        userId: 'user-3',
        status: 'DELIVERING',
        driverId: 'driver-2',
        deliveryMethod: 'direct',
        preparedAt: '2026-08-23T06:00:00.000Z',
        updatedAt: '2026-08-23T10:00:00.000Z',
      },
      'orders/order-pickup-parcel': {
        storeId: 'store-1',
        userId: 'user-4',
        status: 'PREPARING',
        driverId: null,
        deliveryMethod: 'parcel',
        preparedAt: '2026-08-23T11:00:00.000Z',
        updatedAt: '2026-08-23T11:00:00.000Z',
      },
      'orders/order-pickup-hub': {
        storeId: 'store-1',
        userId: 'user-5',
        status: 'PREPARING',
        driverId: null,
        deliveryMethod: 'hub',
        preparedAt: '2026-08-23T09:00:00.000Z',
        updatedAt: '2026-08-23T09:00:00.000Z',
      },
      'users/driver-1': {
        id: 'driver-1',
        role: 'driver',
        driverApproved: true,
        suspended: false,
      },
      'users/seller-1': {
        id: 'seller-1',
        role: 'seller',
        storeId: 'store-1',
        suspended: false,
      },
      'users/seller-2': {
        id: 'seller-2',
        role: 'seller',
        storeId: 'store-2',
        suspended: false,
      },
      'users/consumer-1': {
        id: 'consumer-1',
        role: 'consumer',
        suspended: false,
      },
      'users/seller-orphan': {
        id: 'seller-orphan',
        role: 'seller',
        storeId: 'store-1',
        suspended: false,
      },
      'users/admin-1': {
        id: 'admin-1',
        role: 'admin',
        suspended: false,
      },
      'users/seller-role-lifecycle': {
        id: 'seller-role-lifecycle',
        role: 'seller',
        storeId: 'store-1',
        suspended: false,
      },
      'users/seller-store-lifecycle': {
        id: 'seller-store-lifecycle',
        role: 'seller',
        storeId: 'store-1',
        suspended: false,
      },
      'users/seller-suspended-lifecycle': {
        id: 'seller-suspended-lifecycle',
        role: 'seller',
        storeId: 'store-1',
        suspended: false,
      },
      'users/admin-role-lifecycle': {
        id: 'admin-role-lifecycle',
        role: 'admin',
        suspended: false,
      },
      'users/admin-suspended-lifecycle': {
        id: 'admin-suspended-lifecycle',
        role: 'admin',
        suspended: false,
      },
      'users/driver-2': {
        id: 'driver-2',
        role: 'driver',
        driverApproved: true,
        suspended: false,
      },
      'users/pending-driver': {
        id: 'pending-driver',
        role: 'driver',
        driverApproved: false,
        suspended: false,
      },
      'users/pending-driver-2': {
        id: 'pending-driver-2',
        role: 'driver',
        driverApproved: false,
        suspended: false,
      },
      'users/missing-claim-driver': {
        id: 'missing-claim-driver',
        role: 'driver',
        driverApproved: true,
        suspended: false,
      },
      'users/driver-token-false-db-true': {
        id: 'driver-token-false-db-true',
        role: 'driver',
        driverApproved: true,
        suspended: false,
      },
      'users/driver-stale-approval': {
        id: 'driver-stale-approval',
        role: 'driver',
        driverApproved: true,
        suspended: false,
      },
      'users/driver-lifecycle-approval': {
        id: 'driver-lifecycle-approval',
        role: 'driver',
        driverApproved: false,
        suspended: false,
      },
      'users/driver-lifecycle-suspended': {
        id: 'driver-lifecycle-suspended',
        role: 'driver',
        driverApproved: true,
        suspended: false,
      },
      'users/driver-lifecycle-role': {
        id: 'driver-lifecycle-role',
        role: 'driver',
        driverApproved: true,
        suspended: false,
      },
      'saleRounds/round-1': { storeId: 'store-1', status: 'OPEN' },
      'saleRounds/round-scheduled': { storeId: 'store-1', status: 'SCHEDULED' },
      'saleRounds/round-closed': { storeId: 'store-1', status: 'CLOSED' },
      'saleRounds/round-completed': { storeId: 'store-1', status: 'COMPLETED' },
      'saleRounds/round-draft': { storeId: 'store-1', status: 'DRAFT' },
      'saleRounds/round-cancelled': { storeId: 'store-1', status: 'CANCELLED' },
      'saleRounds/round-unknown': { storeId: 'store-1', status: 'UNKNOWN' },
      'saleRounds/round-store-2': { storeId: 'store-2', status: 'OPEN' },
      'saleRounds/round-missing-store': { storeId: 'store-missing', status: 'OPEN' },
      'saleRounds/round-legacy': { storeId: 'store-legacy', status: 'OPEN' },
      'saleRounds/round-missing-mode': { storeId: 'store-missing-mode', status: 'OPEN' },
      'saleRounds/round-null-mode': { storeId: 'store-null-mode', status: 'OPEN' },
      'saleRounds/round-invalid-mode': { storeId: 'store-invalid-mode', status: 'OPEN' },
      'saleRoundItems/item-1': {
        storeId: 'store-1',
        roundId: 'round-1',
        productId: 'product-1',
        status: 'ACTIVE',
      },
      'saleRoundItems/item-soldout': {
        storeId: 'store-1',
        roundId: 'round-1',
        productId: 'product-1',
        status: 'SOLD_OUT',
      },
      'saleRoundItems/item-closed': {
        storeId: 'store-1',
        roundId: 'round-1',
        productId: 'product-1',
        status: 'CLOSED',
      },
      'saleRoundItems/item-hidden': {
        storeId: 'store-1',
        roundId: 'round-1',
        productId: 'product-1',
        status: 'HIDDEN',
      },
      'saleRoundItems/item-foreign-store': {
        storeId: 'store-2',
        roundId: 'round-1',
        productId: 'product-1',
      },
      'saleRoundItems/item-parent-mismatch': {
        storeId: 'store-1',
        roundId: 'round-store-2',
        productId: 'product-1',
      },
      'saleRoundItems/item-missing-parent': {
        storeId: 'store-1',
        roundId: 'round-missing-parent',
        productId: 'product-1',
      },
      'saleRoundItems/item-draft': {
        storeId: 'store-1',
        roundId: 'round-draft',
        productId: 'product-1',
      },
      'saleRoundItems/item-cancelled': {
        storeId: 'store-1',
        roundId: 'round-cancelled',
        productId: 'product-1',
      },
      'saleRoundItems/item-unknown': {
        storeId: 'store-1',
        roundId: 'round-unknown',
        productId: 'product-1',
      },
      'saleRoundItems/item-legacy': {
        storeId: 'store-legacy',
        roundId: 'round-legacy',
        productId: 'product-1',
      },
      'saleRoundItems/item-missing-mode': {
        storeId: 'store-missing-mode',
        roundId: 'round-missing-mode',
        productId: 'product-1',
      },
      'saleRoundItems/item-null-mode': {
        storeId: 'store-null-mode',
        roundId: 'round-null-mode',
        productId: 'product-1',
      },
      'saleRoundItems/item-invalid-mode': {
        storeId: 'store-invalid-mode',
        roundId: 'round-invalid-mode',
        productId: 'product-1',
      },
    };

    for (const collectionName of SERVER_ONLY_COLLECTIONS) {
      fixtures[`${collectionName}/existing`] = {
        ownerId: 'user-1',
        storeId: 'store-1',
        status: 'ACTIVE',
      };
    }

    await Promise.all(
      Object.entries(fixtures).map(([path, data]) => setDoc(doc(database, path), data)),
    );
  });
}

async function assertDirectAccessDenied(collectionName) {
  for (const [actor, database] of clientContexts()) {
    const existing = doc(database, collectionName, 'existing');
    const created = doc(database, collectionName, `created-${actor}`);

    await assertFails(getDoc(existing));
    await assertFails(setDoc(created, { actor }));
    await assertFails(updateDoc(existing, { actor }));
    await assertFails(deleteDoc(existing));
  }
}

async function assertRoundWritesDenied(collectionName) {
  const existingId = collectionName === 'saleRounds' ? 'round-1' : 'item-1';
  for (const [actor, database] of clientContexts()) {
    const existing = doc(database, collectionName, existingId);
    const created = doc(database, collectionName, `created-${actor}`);

    await assertFails(setDoc(created, { actor }));
    await assertFails(updateDoc(existing, { actor }));
    await assertFails(deleteDoc(existing));
  }
}

before(async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: emulatorConfig(rules),
  });
  await testEnvironment.clearFirestore();
  await seedFixtures();
});

after(async () => {
  await testEnvironment?.cleanup();
});

for (const collectionName of SERVER_ONLY_COLLECTIONS) {
  test(`${collectionName}은 모든 직접 클라이언트 읽기와 쓰기를 거부한다`, async () => {
    await assertDirectAccessDenied(collectionName);
  });
}

test('saleRounds는 공개 상태의 단건 및 제한된 목록 조회만 허용한다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();
  const publicQuery = query(
    collection(database, 'saleRounds'),
    where('storeId', '==', 'store-1'),
    where('status', 'in', ['SCHEDULED', 'OPEN', 'CLOSED', 'COMPLETED']),
  );

  await assertSucceeds(getDoc(doc(database, 'saleRounds', 'round-1')));
  for (const roundId of ['round-scheduled', 'round-closed', 'round-completed']) {
    await assertSucceeds(getDoc(doc(database, 'saleRounds', roundId)));
  }
  await assertSucceeds(getDocs(publicQuery));
  for (const roundId of ['round-draft', 'round-cancelled', 'round-unknown']) {
    await assertFails(getDoc(doc(database, 'saleRounds', roundId)));
  }
  for (const roundId of [
    'round-legacy',
    'round-missing-store',
    'round-missing-mode',
    'round-null-mode',
    'round-invalid-mode',
  ]) {
    await assertFails(getDoc(doc(database, 'saleRounds', roundId)));
  }
  await assertFails(getDocs(collection(database, 'saleRounds')));
});

test('saleRoundItems는 공개 회차에 속한 단건 및 제한된 목록 조회만 허용한다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();
  const publicQuery = query(
    collection(database, 'saleRoundItems'),
    where('roundId', '==', 'round-1'),
    where('storeId', '==', 'store-1'),
    where('status', 'in', ['ACTIVE', 'SOLD_OUT', 'CLOSED']),
  );
  const roundOnlyQuery = query(
    collection(database, 'saleRoundItems'),
    where('roundId', '==', 'round-1'),
  );

  await assertSucceeds(getDoc(doc(database, 'saleRoundItems', 'item-1')));
  await assertSucceeds(getDoc(doc(database, 'saleRoundItems', 'item-soldout')));
  await assertSucceeds(getDoc(doc(database, 'saleRoundItems', 'item-closed')));
  await assertFails(getDoc(doc(database, 'saleRoundItems', 'item-hidden')));
  await assertSucceeds(getDocs(publicQuery));
  for (const itemId of [
    'item-foreign-store',
    'item-parent-mismatch',
    'item-missing-parent',
    'item-draft',
    'item-cancelled',
    'item-unknown',
    'item-legacy',
    'item-missing-mode',
    'item-null-mode',
    'item-invalid-mode',
  ]) {
    await assertFails(getDoc(doc(database, 'saleRoundItems', itemId)));
  }
  await assertFails(getDocs(roundOnlyQuery));
  await assertFails(getDocs(collection(database, 'saleRoundItems')));
});

for (const collectionName of PUBLIC_ROUND_COLLECTIONS) {
  test(`${collectionName}은 모든 직접 클라이언트 생성·수정·삭제를 거부한다`, async () => {
    await assertRoundWritesDenied(collectionName);
  });
}

test('익명 products 원문 읽기는 API 사용 구간에서 거부된다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(database, 'products', 'product-1')));
  await assertFails(getDoc(doc(database, 'products', 'product-inactive')));
  await assertFails(getDoc(doc(database, 'products', 'product-testonly')));
  await assertFails(getDocs(collection(database, 'products')));
  await assertFails(
    getDocs(query(collection(database, 'products'), where('storeId', '==', 'store-1'))),
  );
});

test('비활성/testOnly product는 Firestore 우회로 얻을 수 없다', async () => {
  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  const consumer = testEnvironment
    .authenticatedContext('consumer-1', { role: 'consumer' })
    .firestore();
  const driver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();

  // 익명은 원문 자체를 읽을 수 없으므로 우회가 불가능하다.
  await assertFails(getDoc(doc(anonymous, 'products', 'product-inactive')));
  await assertFails(getDoc(doc(anonymous, 'products', 'product-testonly')));
  // 인증된 non-owner raw read는 owner boundary에서 거부된다.
  // inactive/testOnly 관리는 own-store owning seller만 가능하며
  // 공개 가시성 판정은 API projection이 소유한다.
  await assertFails(getDoc(doc(consumer, 'products', 'product-inactive')));
  await assertFails(getDoc(doc(consumer, 'products', 'product-testonly')));
  await assertFails(getDoc(doc(consumer, 'products', 'product-1')));
  await assertFails(getDoc(doc(driver, 'products', 'product-inactive')));
  await assertFails(getDoc(doc(driver, 'products', 'product-testonly')));
  await assertFails(getDoc(doc(driver, 'products', 'product-1')));
});

test('익명 stores 원문/PII 우회가 불가능하다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(database, 'stores', 'store-1')));
  await assertFails(getDocs(collection(database, 'stores')));
});

test('익명 groupProductConfig 원문 우회가 불가능하다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(database, 'groupProductConfig', 'product-1')));
  await assertFails(getDocs(collection(database, 'groupProductConfig')));
});

test('HIDDEN saleRoundItem 익명 직접 읽기가 불가능하다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(database, 'saleRoundItems', 'item-hidden')));
  // ACTIVE / SOLD_OUT / CLOSED는 기존 공개 의미를 유지한다.
  await assertSucceeds(getDoc(doc(database, 'saleRoundItems', 'item-1')));
  await assertSucceeds(getDoc(doc(database, 'saleRoundItems', 'item-soldout')));
  await assertSucceeds(getDoc(doc(database, 'saleRoundItems', 'item-closed')));
});

test('products owner boundary: consumer/driver는 raw read가 거부된다', async () => {
  const consumer = testEnvironment
    .authenticatedContext('consumer-1', { role: 'consumer' })
    .firestore();
  const driver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();

  await assertFails(getDoc(doc(consumer, 'products', 'product-1')));
  await assertFails(getDocs(collection(consumer, 'products')));
  await assertFails(
    getDocs(query(collection(consumer, 'products'), where('storeId', '==', 'store-1'))),
  );
  await assertFails(getDoc(doc(driver, 'products', 'product-1')));
  await assertFails(getDocs(collection(driver, 'products')));
  await assertFails(
    getDocs(query(collection(driver, 'products'), where('storeId', '==', 'store-1'))),
  );
});

test('products owner boundary: seller A는 own-store만 읽고 cross-store는 거부된다', async () => {
  const sellerA = testEnvironment
    .authenticatedContext('seller-1', { role: 'seller', storeId: 'store-1' })
    .firestore();

  // own active/inactive/testOnly management reads
  await assertSucceeds(getDoc(doc(sellerA, 'products', 'product-1')));
  await assertSucceeds(getDoc(doc(sellerA, 'products', 'product-inactive')));
  await assertSucceeds(getDoc(doc(sellerA, 'products', 'product-testonly')));
  // own store-constrained list (useStoreProducts 형태) — 실제 query behavior 증명
  await assertSucceeds(
    getDocs(query(collection(sellerA, 'products'), where('storeId', '==', 'store-1'))),
  );
  // cross-store denied
  await assertFails(getDoc(doc(sellerA, 'products', 'product-store2')));
  await assertFails(
    getDocs(query(collection(sellerA, 'products'), where('storeId', '==', 'store-2'))),
  );
  // unconstrained cross-store list denied (store-1 + store-2 혼재)
  await assertFails(getDocs(collection(sellerA, 'products')));
});

test('products owner boundary: seller B 대칭 검증', async () => {
  const sellerB = testEnvironment
    .authenticatedContext('seller-2', { role: 'seller', storeId: 'store-2' })
    .firestore();

  await assertSucceeds(getDoc(doc(sellerB, 'products', 'product-store2')));
  await assertSucceeds(
    getDocs(query(collection(sellerB, 'products'), where('storeId', '==', 'store-2'))),
  );
  await assertFails(getDoc(doc(sellerB, 'products', 'product-1')));
  await assertFails(getDoc(doc(sellerB, 'products', 'product-inactive')));
  await assertFails(
    getDocs(query(collection(sellerB, 'products'), where('storeId', '==', 'store-1'))),
  );
  await assertFails(getDocs(collection(sellerB, 'products')));
});

test('products owner boundary: admin 대표 읽기를 유지한다', async () => {
  const admin = testEnvironment.authenticatedContext('admin-1', { role: 'admin' }).firestore();

  await assertSucceeds(getDoc(doc(admin, 'products', 'product-1')));
  await assertSucceeds(getDoc(doc(admin, 'products', 'product-store2')));
  await assertSucceeds(
    getDocs(query(collection(admin, 'products'), where('storeId', '==', 'store-1'))),
  );
});

test('stores owner boundary: consumer/driver/anonymous DENY, owner ALLOW', async () => {
  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  const consumer = testEnvironment
    .authenticatedContext('consumer-1', { role: 'consumer' })
    .firestore();
  const driver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();
  const sellerA = testEnvironment
    .authenticatedContext('seller-1', { role: 'seller', storeId: 'store-1' })
    .firestore();
  const sellerB = testEnvironment
    .authenticatedContext('seller-2', { role: 'seller', storeId: 'store-2' })
    .firestore();
  const admin = testEnvironment.authenticatedContext('admin-1', { role: 'admin' }).firestore();

  await assertFails(getDoc(doc(anonymous, 'stores', 'store-1')));
  await assertFails(getDoc(doc(consumer, 'stores', 'store-1')));
  await assertFails(getDoc(doc(driver, 'stores', 'store-1')));
  await assertSucceeds(getDoc(doc(sellerA, 'stores', 'store-1')));
  await assertFails(getDoc(doc(sellerA, 'stores', 'store-2')));
  await assertSucceeds(getDoc(doc(sellerB, 'stores', 'store-2')));
  await assertFails(getDoc(doc(sellerB, 'stores', 'store-1')));
  await assertSucceeds(getDoc(doc(admin, 'stores', 'store-1')));
  // list는 기존처럼 DENY (owner/admin 포함)
  await assertFails(getDocs(collection(sellerA, 'stores')));
  await assertFails(getDocs(collection(admin, 'stores')));
  await assertFails(getDocs(collection(consumer, 'stores')));
});

test('groupProductConfig owner boundary: point get만 owner/admin 허용', async () => {
  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  const consumer = testEnvironment
    .authenticatedContext('consumer-1', { role: 'consumer' })
    .firestore();
  const driver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();
  const sellerA = testEnvironment
    .authenticatedContext('seller-1', { role: 'seller', storeId: 'store-1' })
    .firestore();
  const sellerB = testEnvironment
    .authenticatedContext('seller-2', { role: 'seller', storeId: 'store-2' })
    .firestore();
  const admin = testEnvironment.authenticatedContext('admin-1', { role: 'admin' }).firestore();

  await assertFails(getDoc(doc(anonymous, 'groupProductConfig', 'product-1')));
  await assertFails(getDoc(doc(consumer, 'groupProductConfig', 'product-1')));
  await assertFails(getDoc(doc(driver, 'groupProductConfig', 'product-1')));
  // underlying product의 store ownership으로 판정 (products/product-1 → store-1)
  await assertSucceeds(getDoc(doc(sellerA, 'groupProductConfig', 'product-1')));
  await assertFails(getDoc(doc(sellerA, 'groupProductConfig', 'product-store2')));
  await assertSucceeds(getDoc(doc(sellerB, 'groupProductConfig', 'product-store2')));
  await assertFails(getDoc(doc(sellerB, 'groupProductConfig', 'product-1')));
  await assertSucceeds(getDoc(doc(admin, 'groupProductConfig', 'product-1')));
  // list는 owner workflow가 요구하지 않으므로 DENY 유지 (새 capability 생성 금지)
  await assertFails(getDocs(collection(sellerA, 'groupProductConfig')));
  await assertFails(getDocs(collection(consumer, 'groupProductConfig')));
  await assertFails(getDocs(collection(admin, 'groupProductConfig')));
});

test('products owner authority는 token/users/storeId를 넘어 stores.ownerId를 요구한다', async () => {
  // seller-orphan: token storeId + users storeId는 store-1과 일치하지만
  // stores/store-1.ownerId(seller-1)와 달라 API도 거부하는 principal.
  // Rules가 currentSellerFor만 복사했다면 허용됐을 것이다.
  const orphan = testEnvironment
    .authenticatedContext('seller-orphan', { role: 'seller', storeId: 'store-1' })
    .firestore();

  await assertFails(getDoc(doc(orphan, 'products', 'product-1')));
  await assertFails(
    getDocs(query(collection(orphan, 'products'), where('storeId', '==', 'store-1'))),
  );
  await assertFails(getDoc(doc(orphan, 'stores', 'store-1')));
  await assertFails(getDoc(doc(orphan, 'groupProductConfig', 'product-1')));
});

test('인증된 seller owner surface 읽기( products/stores/groupConfig )를 보존한다', async () => {
  const seller = testEnvironment
    .authenticatedContext('seller-1', { role: 'seller', storeId: 'store-1' })
    .firestore();

  await assertSucceeds(getDoc(doc(seller, 'products', 'product-1')));
  await assertSucceeds(
    getDocs(query(collection(seller, 'products'), where('storeId', '==', 'store-1'))),
  );
  await assertSucceeds(getDoc(doc(seller, 'stores', 'store-1')));
  await assertSucceeds(getDoc(doc(seller, 'groupProductConfig', 'product-1')));
});

test('공개 dailyCaps 직접 구독을 보존한다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(database, 'dailyCaps', 'store-1_2026-07-18')));
  await assertSucceeds(getDocs(collection(database, 'dailyCaps')));
});

test('품종은 공개 단건 조회만 허용하고 목록과 모든 직접 쓰기를 거부한다', async () => {
  const publicDatabase = testEnvironment.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(publicDatabase, 'varieties', 'variety-1')));
  await assertFails(getDocs(collection(publicDatabase, 'varieties')));

  for (const [actor, database] of clientContexts()) {
    const existing = doc(database, 'varieties', 'variety-1');
    const created = doc(database, 'varieties', `created-${actor}`);

    await assertFails(setDoc(created, { actor }));
    await assertFails(updateDoc(existing, { actor }));
    await assertFails(deleteDoc(existing));
  }
});

test('기존 주문의 판매자·관리자 읽기와 기사의 API 전용 경계를 보존한다', async () => {
  const seller = testEnvironment
    .authenticatedContext('seller-1', { role: 'seller', storeId: 'store-1' })
    .firestore();
  const driver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();
  const admin = testEnvironment.authenticatedContext('admin-1', { role: 'admin' }).firestore();
  const user = testEnvironment.authenticatedContext('user-1').firestore();

  await assertSucceeds(getDoc(doc(seller, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(seller, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(driver, 'orders', 'order-store-2')));
  await assertSucceeds(getDoc(doc(admin, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(user, 'orders', 'order-store-1')));
});

test('기사는 배정·미배정·무관 주문을 포함한 모든 orders raw read를 거부당한다', async () => {
  const approvedDriver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();
  const pendingDriver = testEnvironment
    .authenticatedContext('pending-driver', { role: 'driver', driverApproved: false })
    .firestore();
  const suspendedDriver = testEnvironment
    .authenticatedContext('driver-lifecycle-suspended', {
      role: 'driver',
      driverApproved: true,
    })
    .firestore();

  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-pickup-hub')));
  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-driver-other')));
  await assertFails(getDoc(doc(pendingDriver, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(suspendedDriver, 'orders', 'order-store-2')));

  const assignedQuery = query(
    collection(approvedDriver, 'orders'),
    where('driverId', '==', 'driver-1'),
  );
  const pickupQuery = query(
    collection(approvedDriver, 'orders'),
    where('status', '==', 'PREPARING'),
    where('deliveryMethod', 'in', ['direct', 'hub']),
    where('driverId', '==', null),
  );
  const unboundedDriverQuery = query(
    collection(approvedDriver, 'orders'),
    where('status', 'in', ['PREPARING', 'DELIVERING']),
  );

  await assertFails(getDocs(assignedQuery));
  await assertFails(getDocs(pickupQuery));
  await assertFails(getDocs(unboundedDriverQuery));
});

test('주문은 미인증·consumer·seller·미승인 driver·승인 claim 누락 driver가 읽을 수 없다', async () => {
  const unauthenticated = testEnvironment.unauthenticatedContext().firestore();
  const consumer = testEnvironment
    .authenticatedContext('consumer-1', { role: 'consumer' })
    .firestore();
  const seller = testEnvironment
    .authenticatedContext('seller-1', { role: 'seller', storeId: 'store-1' })
    .firestore();
  const pendingDriver = testEnvironment
    .authenticatedContext('pending-driver-2', { role: 'driver', driverApproved: false })
    .firestore();
  const missingClaimDriver = testEnvironment
    .authenticatedContext('missing-claim-driver', { role: 'driver' })
    .firestore();

  await assertFails(getDoc(doc(unauthenticated, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(consumer, 'orders', 'order-store-1')));
  await assertFails(getDocs(collection(seller, 'orders')));
  await assertFails(getDoc(doc(seller, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(pendingDriver, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(missingClaimDriver, 'orders', 'order-store-1')));
});

test('승인된 driver도 orders raw read와 주문 write를 할 수 없다', async () => {
  const approvedDriver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();
  const otherApprovedDriver = testEnvironment
    .authenticatedContext('driver-2', { role: 'driver', driverApproved: true })
    .firestore();

  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-driver-other')));
  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-pickup-parcel')));
  await assertFails(getDoc(doc(otherApprovedDriver, 'orders', 'order-store-2')));

  await assertFails(
    setDoc(doc(approvedDriver, 'orders', 'order-created-by-driver'), {
      status: 'DELIVERING',
      driverId: 'driver-1',
    }),
  );
  await assertFails(
    updateDoc(doc(approvedDriver, 'orders', 'order-store-1'), { driverId: 'driver-1' }),
  );
  await assertFails(deleteDoc(doc(approvedDriver, 'orders', 'order-store-1')));
});

test('driver 화면에서 사용하던 모든 orders query는 직접 읽기를 거부당한다', async () => {
  const approvedDriver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();

  const pickupQuery = query(
    collection(approvedDriver, 'orders'),
    where('status', '==', 'PREPARING'),
    where('deliveryMethod', 'in', ['direct', 'hub']),
    where('driverId', '==', null),
    // driver 보드의 실제 정렬 조건
    orderBy('preparedAt', 'asc'),
  );
  const boardAssignedQuery = query(
    collection(approvedDriver, 'orders'),
    where('status', 'in', ['DELIVERING', 'DELIVERY_HELD']),
    where('driverId', '==', 'driver-1'),
    // driver 보드의 실제 정렬 조건
    orderBy('updatedAt', 'asc'),
  );
  const mapAssignedQuery = query(
    collection(approvedDriver, 'orders'),
    where('status', '==', 'DELIVERING'),
    where('driverId', '==', 'driver-1'),
  );
  const directPickupQuery = query(
    collection(approvedDriver, 'orders'),
    where('status', '==', 'PREPARING'),
    where('deliveryMethod', '==', 'direct'),
    where('driverId', '==', null),
  );
  const hubPickupQuery = query(
    collection(approvedDriver, 'orders'),
    where('status', '==', 'PREPARING'),
    where('deliveryMethod', '==', 'hub'),
    where('driverId', '==', null),
  );
  const unboundedQuery = query(
    collection(approvedDriver, 'orders'),
    where('status', 'in', ['PREPARING', 'DELIVERING']),
  );

  await assertFails(getDocs(pickupQuery));
  await assertFails(getDocs(boardAssignedQuery));
  await assertFails(getDocs(mapAssignedQuery));
  await assertFails(getDocs(directPickupQuery));
  await assertFails(getDocs(hubPickupQuery));
  await assertFails(getDocs(unboundedQuery));
});

test('이미 승인된 token도 users.driverApproved가 false가 되면 주문 read가 즉시 거부된다', async () => {
  const driverToken = testEnvironment
    .authenticatedContext('driver-stale-approval', { role: 'driver', driverApproved: true })
    .firestore();

  await assertFails(getDoc(doc(driverToken, 'orders', 'order-store-1')));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'users', 'driver-stale-approval'), {
      driverApproved: false,
    });
  });

  await assertFails(getDoc(doc(driverToken, 'orders', 'order-store-1')));

  const staleQuery = query(
    collection(driverToken, 'orders'),
    where('status', '==', 'PREPARING'),
    where('deliveryMethod', '==', 'direct'),
    where('driverId', '==', null),
  );
  await assertFails(getDocs(staleQuery));
});

test('이미 승인된 token도 users.suspended가 true가 되면 주문 read가 즉시 거부된다', async () => {
  const driverToken = testEnvironment
    .authenticatedContext('driver-lifecycle-suspended', {
      role: 'driver',
      driverApproved: true,
    })
    .firestore();

  await assertFails(getDoc(doc(driverToken, 'orders', 'order-store-1')));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'users', 'driver-lifecycle-suspended'), {
      suspended: true,
    });
  });

  await assertFails(getDoc(doc(driverToken, 'orders', 'order-store-1')));
});

test('이미 승인된 token도 users.role이 driver가 아니게 되면 주문 read가 즉시 거부된다', async () => {
  const driverToken = testEnvironment
    .authenticatedContext('driver-lifecycle-role', { role: 'driver', driverApproved: true })
    .firestore();

  await assertFails(getDoc(doc(driverToken, 'orders', 'order-store-1')));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'users', 'driver-lifecycle-role'), {
      role: 'consumer',
    });
  });

  await assertFails(getDoc(doc(driverToken, 'orders', 'order-store-1')));
});

test('users 문서가 없거나 token claim이 false이면 현재 DB가 승인 상태여도 거부된다', async () => {
  const missingUserToken = testEnvironment
    .authenticatedContext('driver-no-user', { role: 'driver', driverApproved: true })
    .firestore();
  const falseClaimToken = testEnvironment
    .authenticatedContext('driver-token-false-db-true', {
      role: 'driver',
      driverApproved: false,
    })
    .firestore();

  await assertFails(getDoc(doc(missingUserToken, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(falseClaimToken, 'orders', 'order-store-1')));
});

test('미승인 users가 승인된 뒤 새 승인 token만 주문 read를 허용한다', async () => {
  const oldToken = testEnvironment
    .authenticatedContext('driver-lifecycle-approval', { role: 'driver', driverApproved: false })
    .firestore();

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'users', 'driver-lifecycle-approval'), {
      driverApproved: true,
      suspended: false,
    });
  });

  await assertFails(getDoc(doc(oldToken, 'orders', 'order-store-1')));
  const newToken = testEnvironment
    .authenticatedContext('driver-lifecycle-approval', { role: 'driver', driverApproved: true })
    .firestore();
  await assertFails(getDoc(doc(newToken, 'orders', 'order-store-1')));
});

test('seller 주문 read는 token과 현재 user의 role/storeId/suspension을 함께 검증한다', async () => {
  const roleChanged = testEnvironment
    .authenticatedContext('seller-role-lifecycle', { role: 'seller', storeId: 'store-1' })
    .firestore();
  const storeChanged = testEnvironment
    .authenticatedContext('seller-store-lifecycle', { role: 'seller', storeId: 'store-1' })
    .firestore();
  const suspended = testEnvironment
    .authenticatedContext('seller-suspended-lifecycle', { role: 'seller', storeId: 'store-1' })
    .firestore();

  await assertSucceeds(getDoc(doc(roleChanged, 'orders', 'order-store-1')));
  await assertSucceeds(getDoc(doc(storeChanged, 'orders', 'order-store-1')));
  await assertSucceeds(getDoc(doc(suspended, 'orders', 'order-store-1')));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await updateDoc(doc(database, 'users', 'seller-role-lifecycle'), { role: 'consumer' });
    await updateDoc(doc(database, 'users', 'seller-store-lifecycle'), { storeId: 'store-2' });
    await updateDoc(doc(database, 'users', 'seller-suspended-lifecycle'), { suspended: true });
  });

  await assertFails(getDoc(doc(roleChanged, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(storeChanged, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(suspended, 'orders', 'order-store-1')));
});

test('admin 주문 read는 token과 현재 user의 role/suspension을 함께 검증한다', async () => {
  const roleChanged = testEnvironment
    .authenticatedContext('admin-role-lifecycle', { role: 'admin' })
    .firestore();
  const suspended = testEnvironment
    .authenticatedContext('admin-suspended-lifecycle', { role: 'admin' })
    .firestore();

  await assertSucceeds(getDoc(doc(roleChanged, 'orders', 'order-store-2')));
  await assertSucceeds(getDoc(doc(suspended, 'orders', 'order-store-2')));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await updateDoc(doc(database, 'users', 'admin-role-lifecycle'), { role: 'consumer' });
    await updateDoc(doc(database, 'users', 'admin-suspended-lifecycle'), { suspended: true });
  });

  await assertFails(getDoc(doc(roleChanged, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(suspended, 'orders', 'order-store-2')));
});
