import assert from 'node:assert/strict';
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
      'products/product-1': { storeId: 'store-1', name: '공개 상품' },
      'stores/store-1': { name: '공개 매장', salesMode: 'round_direct' },
      'dailyCaps/store-1_2026-07-18': { storeId: 'store-1', date: '2026-07-18' },
      'groupProductConfig/product-1': { storeId: 'store-1', productId: 'product-1' },
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
    where('storeId', '==', 'store-1'),
  );
  const roundOnlyQuery = query(
    collection(database, 'saleRoundItems'),
    where('roundId', '==', 'round-1'),
  );

  await assertSucceeds(getDoc(doc(database, 'saleRoundItems', 'item-1')));
  await assertSucceeds(getDocs(publicQuery));
  await assertFails(getDoc(doc(database, 'saleRoundItems', 'item-draft')));
  await assertFails(getDocs(roundOnlyQuery));
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

test('기존 주문의 판매자 매장과 기사 및 관리자 읽기 권한을 보존한다', async () => {
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
  await assertSucceeds(getDoc(doc(driver, 'orders', 'order-store-2')));
  await assertSucceeds(getDoc(doc(admin, 'orders', 'order-store-2')));
  await assertFails(getDoc(doc(user, 'orders', 'order-store-1')));
});

test('승인된 기사는 배정 주문과 미배정 수거 주문만 읽고 다른 기사 주문은 읽지 못한다', async () => {
  const approvedDriver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();
  const pendingDriver = testEnvironment
    .authenticatedContext('pending-driver', { role: 'driver', driverApproved: false })
    .firestore();

  await assertSucceeds(getDoc(doc(approvedDriver, 'orders', 'order-store-2')));
  await assertSucceeds(getDoc(doc(approvedDriver, 'orders', 'order-store-1')));
  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-driver-other')));
  await assertFails(getDoc(doc(approvedDriver, 'orders', 'order-pickup-parcel')));
  await assertFails(getDoc(doc(pendingDriver, 'orders', 'order-store-2')));

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

  await assertSucceeds(getDocs(assignedQuery));
  await assertSucceeds(getDocs(pickupQuery));
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

test('승인된 driver는 허용된 주문만 읽고 주문 write는 할 수 없다', async () => {
  const approvedDriver = testEnvironment
    .authenticatedContext('driver-1', { role: 'driver', driverApproved: true })
    .firestore();
  const otherApprovedDriver = testEnvironment
    .authenticatedContext('driver-2', { role: 'driver', driverApproved: true })
    .firestore();

  await assertSucceeds(getDoc(doc(approvedDriver, 'orders', 'order-store-1')));
  await assertSucceeds(getDoc(doc(approvedDriver, 'orders', 'order-store-2')));
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

test('driver 화면의 실제 pickup·assigned query는 허용 범위를 벗어나지 않는다', async () => {
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

  const pickupSnapshot = await assertSucceeds(getDocs(pickupQuery));
  const boardAssignedSnapshot = await assertSucceeds(getDocs(boardAssignedQuery));
  const mapAssignedSnapshot = await assertSucceeds(getDocs(mapAssignedQuery));
  const directPickupSnapshot = await assertSucceeds(getDocs(directPickupQuery));
  const hubPickupSnapshot = await assertSucceeds(getDocs(hubPickupQuery));

  assert.deepEqual(
    pickupSnapshot.docs.map((snapshot) => snapshot.id),
    ['order-store-1', 'order-pickup-hub'],
  );
  assert.deepEqual(
    boardAssignedSnapshot.docs.map((snapshot) => snapshot.id),
    ['order-store-2'],
  );
  assert.deepEqual(
    mapAssignedSnapshot.docs.map((snapshot) => snapshot.id),
    ['order-store-2'],
  );
  assert.deepEqual(
    directPickupSnapshot.docs.map((snapshot) => snapshot.id),
    ['order-store-1'],
  );
  assert.deepEqual(
    hubPickupSnapshot.docs.map((snapshot) => snapshot.id),
    ['order-pickup-hub'],
  );
  await assertFails(getDocs(unboundedQuery));
});

test('이미 승인된 token도 users.driverApproved가 false가 되면 주문 read가 즉시 거부된다', async () => {
  const driverToken = testEnvironment
    .authenticatedContext('driver-stale-approval', { role: 'driver', driverApproved: true })
    .firestore();

  await assertSucceeds(getDoc(doc(driverToken, 'orders', 'order-store-1')));

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

  await assertSucceeds(getDoc(doc(driverToken, 'orders', 'order-store-1')));

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

  await assertSucceeds(getDoc(doc(driverToken, 'orders', 'order-store-1')));

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
  await assertSucceeds(getDoc(doc(newToken, 'orders', 'order-store-1')));
});
