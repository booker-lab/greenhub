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
    ['기사', testEnvironment.authenticatedContext('driver-1', { role: 'driver' }).firestore()],
    ['관리자', testEnvironment.authenticatedContext('admin-1', { role: 'admin' }).firestore()],
  ];
}

async function seedFixtures() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const fixtures = {
      'products/product-1': { storeId: 'store-1', name: '공개 상품' },
      'stores/store-1': { name: '공개 매장', salesMode: 'round_direct' },
      'dailyCaps/store-1_2026-07-18': { storeId: 'store-1', date: '2026-07-18' },
      'groupProductConfig/product-1': { storeId: 'store-1', productId: 'product-1' },
      'orders/order-store-1': { storeId: 'store-1', userId: 'user-1' },
      'orders/order-store-2': { storeId: 'store-2', userId: 'user-2' },
      'saleRounds/round-1': { storeId: 'store-1', status: 'OPEN' },
      'saleRounds/round-draft': { storeId: 'store-1', status: 'DRAFT' },
      'saleRoundItems/item-1': {
        storeId: 'store-1',
        roundId: 'round-1',
        productId: 'product-1',
      },
      'saleRoundItems/item-draft': {
        storeId: 'store-1',
        roundId: 'round-draft',
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
    where('status', 'in', ['SCHEDULED', 'OPEN', 'CLOSED', 'COMPLETED']),
  );

  await assertSucceeds(getDoc(doc(database, 'saleRounds', 'round-1')));
  await assertSucceeds(getDocs(publicQuery));
  await assertFails(getDoc(doc(database, 'saleRounds', 'round-draft')));
  await assertFails(getDocs(collection(database, 'saleRounds')));
});

test('saleRoundItems는 공개 회차에 속한 단건 및 제한된 목록 조회만 허용한다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();
  const publicQuery = query(
    collection(database, 'saleRoundItems'),
    where('roundId', '==', 'round-1'),
  );

  await assertSucceeds(getDoc(doc(database, 'saleRoundItems', 'item-1')));
  await assertSucceeds(getDocs(publicQuery));
  await assertFails(getDoc(doc(database, 'saleRoundItems', 'item-draft')));
  await assertFails(getDocs(collection(database, 'saleRoundItems')));
});

for (const collectionName of PUBLIC_ROUND_COLLECTIONS) {
  test(`${collectionName}은 모든 직접 클라이언트 생성·수정·삭제를 거부한다`, async () => {
    await assertRoundWritesDenied(collectionName);
  });
}

test('기존 공개 상품과 매장 및 재고 조회를 보존한다', async () => {
  const database = testEnvironment.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(database, 'products', 'product-1')));
  await assertSucceeds(getDocs(collection(database, 'products')));
  await assertSucceeds(getDoc(doc(database, 'stores', 'store-1')));
  await assertSucceeds(getDoc(doc(database, 'dailyCaps', 'store-1_2026-07-18')));
  await assertSucceeds(getDocs(collection(database, 'dailyCaps')));
  await assertSucceeds(getDoc(doc(database, 'groupProductConfig', 'product-1')));
  await assertSucceeds(getDocs(collection(database, 'groupProductConfig')));
});

test('기존 주문의 판매자 매장과 기사 및 관리자 읽기 권한을 보존한다', async () => {
  const seller = testEnvironment
    .authenticatedContext('seller-1', { role: 'seller', storeId: 'store-1' })
    .firestore();
  const driver = testEnvironment.authenticatedContext('driver-1', { role: 'driver' }).firestore();
  const admin = testEnvironment.authenticatedContext('admin-1', { role: 'admin' }).firestore();
  const user = testEnvironment.authenticatedContext('user-1').firestore();

  await assertSucceeds(getDoc(doc(seller, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(seller, 'orders', 'order-store-2')));
  await assertSucceeds(getDoc(doc(driver, 'orders', 'order-store-2')));
  await assertSucceeds(getDoc(doc(admin, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(user, 'orders', 'order-store-1')));
});
