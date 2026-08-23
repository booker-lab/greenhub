import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'demo-greenhub';
const BUCKET_URL = `gs://${PROJECT_ID}.appspot.com`;
const FIVE_MIB = 5 * 1024 * 1024;
const TWO_MIB = 2 * 1024 * 1024;

let testEnvironment;

function emulatorConfig(rules) {
  const [host, rawPort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199').split(
    ':',
  );
  return {
    rules,
    host,
    port: Number(rawPort),
  };
}

function firestoreEmulatorConfig(rules) {
  const [host, rawPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  return {
    rules,
    host,
    port: Number(rawPort),
  };
}

function storageFor(uid, claims) {
  const context = uid
    ? testEnvironment.authenticatedContext(uid, claims)
    : testEnvironment.unauthenticatedContext();
  return context.storage(BUCKET_URL);
}

function actorStorages() {
  return [
    ['인증 없음', storageFor()],
    ['일반 사용자', storageFor('user-1', { role: 'consumer' })],
    ['판매자', storageFor('seller-1', { role: 'seller', storeId: 'store-1' })],
    ['다른 판매자', storageFor('seller-2', { role: 'seller', storeId: 'store-2' })],
    ['기사', storageFor('driver-1', { role: 'driver' })],
    ['다른 기사', storageFor('driver-2', { role: 'driver' })],
    ['관리자', storageFor('admin-1', { role: 'admin' })],
  ];
}

function content(size = 16) {
  return new Uint8Array(size).fill(1);
}

function objectRef(storage, path) {
  return storage.ref(path);
}

function upload(storage, path, contentType, size = 16) {
  return objectRef(storage, path).put(content(size), { contentType });
}

async function seedFixtures() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const storage = context.storage(BUCKET_URL);
    const firestore = context.firestore();
    await Promise.all([
      firestore.collection('orders').doc('order-legacy').set({
        driverId: 'driver-1',
        deliveryMethod: 'hub',
        status: 'DELIVERING',
      }),
      firestore.collection('orders').doc('order_legacy').set({
        driverId: 'driver-1',
        deliveryMethod: 'hub',
        status: 'DELIVERING',
      }),
      upload(storage, 'deliveryPhotos/order-1/private-photo.jpg', 'image/jpeg'),
      upload(storage, 'deliveryPhotos/order-legacy_1721433600000.jpg', 'image/jpeg'),
      upload(storage, 'deliveryPhotos/order_legacy_1721433600000.jpg', 'image/jpeg'),
      upload(storage, 'products/store-1/public-product.jpg', 'image/jpeg'),
      upload(storage, 'products/store-1/product-update.jpg', 'image/jpeg'),
      upload(storage, 'products/store-1/product-delete.jpg', 'image/jpeg'),
      upload(storage, 'banners/main_hero/public-banner.png', 'image/png'),
      upload(storage, 'banners/main_hero/banner-update.png', 'image/png'),
      upload(storage, 'banners/main_hero/banner-delete.png', 'image/png'),
      upload(storage, 'logos/seller-1_1721433600000', 'image/webp'),
      upload(storage, 'logos/seller-1_1721433600001', 'image/png'),
      upload(storage, 'logos/seller-1_1721433600002', 'image/jpeg'),
    ]);
  });
}

before(async () => {
  const [storageRules, firestoreRules] = await Promise.all([
    readFile(new URL('../../storage.rules', import.meta.url), 'utf8'),
    readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
  ]);
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: firestoreEmulatorConfig(firestoreRules),
    storage: emulatorConfig(storageRules),
  });
  await testEnvironment.clearFirestore();
  await testEnvironment.clearStorage();
  await seedFixtures();
});

after(async () => {
  await testEnvironment?.cleanup();
});

test('회차 직배송 사진은 모든 클라이언트의 직접 읽기·생성·수정·삭제를 거부한다', async () => {
  for (const [actor, storage] of actorStorages()) {
    const existing = objectRef(storage, 'deliveryPhotos/order-1/private-photo.jpg');

    await assertFails(existing.getMetadata());
    await assertFails(
      upload(
        storage,
        `deliveryPhotos/order-1/created-${encodeURIComponent(actor)}.jpg`,
        'image/jpeg',
      ),
    );
    await assertFails(existing.put(content(), { contentType: 'image/jpeg' }));
    await assertFails(existing.delete());
  }
});

test('상품 이미지는 공개 읽기를 유지하고 소유 판매자와 관리자만 변경한다', async () => {
  const publicStorage = storageFor();
  const seller = storageFor('seller-1', { role: 'seller', storeId: 'store-1' });
  const admin = storageFor('admin-1', { role: 'admin' });

  await assertSucceeds(
    objectRef(publicStorage, 'products/store-1/public-product.jpg').getMetadata(),
  );
  await assertSucceeds(upload(seller, 'products/store-1/new-product.jpg', 'image/jpeg'));
  await assertSucceeds(upload(admin, 'products/store-2/admin-product.webp', 'image/webp'));
  await assertSucceeds(
    objectRef(seller, 'products/store-1/product-update.jpg').updateMetadata({
      contentType: 'image/png',
    }),
  );
  await assertSucceeds(objectRef(seller, 'products/store-1/product-delete.jpg').delete());
});

test('상품 이미지는 인증·storeId 소유권·역할을 모두 검증한다', async () => {
  const deniedActors = [
    storageFor(),
    storageFor('user-1', { role: 'consumer' }),
    storageFor('seller-2', { role: 'seller', storeId: 'store-2' }),
    storageFor('driver-1', { role: 'driver' }),
  ];

  for (const storage of deniedActors) {
    await assertFails(upload(storage, 'products/store-1/forbidden-product.jpg', 'image/jpeg'));
  }
});

test('상품 이미지는 5MiB 이하의 실제 허용 contentType만 받고 중첩 경로를 거부한다', async () => {
  const seller = storageFor('seller-1', { role: 'seller', storeId: 'store-1' });

  await assertSucceeds(
    upload(seller, 'products/store-1/extension-is-not-trusted.txt', 'image/png'),
  );
  await assertFails(upload(seller, 'products/store-1/oversized.jpg', 'image/jpeg', FIVE_MIB + 1));
  await assertFails(upload(seller, 'products/store-1/vector.svg', 'image/svg+xml'));
  await assertFails(upload(seller, 'products/store-1/nested/product.jpg', 'image/jpeg'));
});

test('배너 이미지는 공개 읽기를 유지하고 관리자만 생성·수정·삭제한다', async () => {
  const publicStorage = storageFor();
  const admin = storageFor('admin-1', { role: 'admin' });
  const seller = storageFor('seller-1', { role: 'seller', storeId: 'store-1' });

  await assertSucceeds(
    objectRef(publicStorage, 'banners/main_hero/public-banner.png').getMetadata(),
  );
  await assertSucceeds(upload(admin, 'banners/main_hero/admin-banner.webp', 'image/webp'));
  await assertSucceeds(
    objectRef(admin, 'banners/main_hero/banner-update.png').updateMetadata({
      contentType: 'image/jpeg',
    }),
  );
  await assertSucceeds(objectRef(admin, 'banners/main_hero/banner-delete.png').delete());
  await assertFails(upload(seller, 'banners/main_hero/seller-banner.png', 'image/png'));
});

test('배너 이미지는 5MiB 이하의 허용 contentType과 고정 경로만 받는다', async () => {
  const admin = storageFor('admin-1', { role: 'admin' });

  await assertFails(upload(admin, 'banners/main_hero/oversized.png', 'image/png', FIVE_MIB + 1));
  await assertFails(upload(admin, 'banners/main_hero/vector.svg', 'image/svg+xml'));
  await assertFails(upload(admin, 'banners/other/banner.png', 'image/png'));
});

test('상점 로고는 공개 읽기를 유지하고 판매자 본인 이름의 객체만 변경한다', async () => {
  const publicStorage = storageFor();
  const seller = storageFor('seller-1', { role: 'seller', storeId: 'store-1' });

  await assertSucceeds(objectRef(publicStorage, 'logos/seller-1_1721433600000').getMetadata());
  await assertSucceeds(upload(seller, 'logos/seller-1_1721433600010', 'image/jpeg'));
  await assertSucceeds(
    objectRef(seller, 'logos/seller-1_1721433600001').updateMetadata({
      contentType: 'image/png',
    }),
  );
  await assertSucceeds(objectRef(seller, 'logos/seller-1_1721433600002').delete());
});

test('상점 로고는 잘못된 소유자·역할·크기·contentType·경로를 거부한다', async () => {
  const seller = storageFor('seller-1', { role: 'seller', storeId: 'store-1' });
  const otherSeller = storageFor('seller-2', { role: 'seller', storeId: 'store-2' });
  const admin = storageFor('admin-1', { role: 'admin' });

  await assertFails(upload(otherSeller, 'logos/seller-1_1721433600011', 'image/png'));
  await assertFails(upload(admin, 'logos/admin-1_1721433600012', 'image/png'));
  await assertFails(upload(seller, 'logos/seller-1_1721433600013', 'image/jpeg', TWO_MIB + 1));
  await assertFails(upload(seller, 'logos/seller-1_1721433600014', 'image/gif'));
  await assertFails(upload(seller, 'logos/seller-1/not-flat.png', 'image/png'));
});

test('legacy 거점 사진은 담당 기사에게만 단건 읽기와 평면 JPEG 생성을 허용한다', async () => {
  const assignedDriver = storageFor('driver-1', { role: 'driver' });
  const existing = objectRef(assignedDriver, 'deliveryPhotos/order-legacy_1721433600000.jpg');

  await assertSucceeds(existing.getMetadata());
  await assertSucceeds(
    upload(assignedDriver, 'deliveryPhotos/order-legacy_1721433600010.jpg', 'image/jpeg'),
  );
  await assertSucceeds(
    objectRef(assignedDriver, 'deliveryPhotos/order_legacy_1721433600000.jpg').getMetadata(),
  );
  await assertSucceeds(
    upload(assignedDriver, 'deliveryPhotos/order_legacy_1721433600010.jpg', 'image/jpeg'),
  );

  for (const storage of [
    storageFor(),
    storageFor('user-1', { role: 'consumer' }),
    storageFor('seller-1', { role: 'seller', storeId: 'store-1' }),
    storageFor('driver-2', { role: 'driver' }),
    storageFor('admin-1', { role: 'admin' }),
  ]) {
    await assertFails(
      objectRef(storage, 'deliveryPhotos/order-legacy_1721433600000.jpg').getMetadata(),
    );
    await assertFails(
      upload(storage, 'deliveryPhotos/order-legacy_1721433600011.jpg', 'image/jpeg'),
    );
    await assertFails(
      objectRef(storage, 'deliveryPhotos/order_legacy_1721433600000.jpg').getMetadata(),
    );
  }
});

test('legacy 평면 경로 목록 조회는 담당 기사를 포함한 모든 클라이언트에서 거부한다', async () => {
  for (const storage of [
    storageFor('driver-1', { role: 'driver' }),
    storageFor('driver-2', { role: 'driver' }),
  ]) {
    await assertFails(objectRef(storage, 'deliveryPhotos').listAll());
  }
});

test('legacy 거점 사진은 수정·삭제와 잘못된 경로·크기·contentType을 거부한다', async () => {
  const driver = storageFor('driver-1', { role: 'driver' });
  const existing = objectRef(driver, 'deliveryPhotos/order-legacy_1721433600000.jpg');

  await assertFails(existing.put(content(), { contentType: 'image/jpeg' }));
  await assertFails(existing.delete());
  await assertFails(upload(driver, 'deliveryPhotos/not-a-legacy-name.jpg', 'image/jpeg'));
  await assertFails(upload(driver, 'deliveryPhotos/order-legacy_1721433600012.jpg', 'image/png'));
  await assertFails(
    upload(driver, 'deliveryPhotos/order-legacy_1721433600013.jpg', 'image/jpeg', FIVE_MIB + 1),
  );
});

test('정의되지 않은 경로는 모든 역할의 직접 접근을 거부한다', async () => {
  for (const [, storage] of actorStorages()) {
    await assertFails(upload(storage, 'unknown/file.jpg', 'image/jpeg'));
  }
});
