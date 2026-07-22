import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFixtureManifest,
  cleanupFixture,
  seedFixture,
  validateFixtureEnvironment,
  verifyFixture,
} from './round-direct-e2e-fixtures.mjs';

const runId = 'task-6-7-run-001';
const accounts = {
  consumer: { email: 'consumer-chromium@example.test', passwordHash: 'hash-consumer' },
  seller: { email: 'seller-chromium@example.test', passwordHash: 'hash-seller' },
  driver: { email: 'driver-chromium@example.test', passwordHash: 'hash-driver' },
};

function validEnvironment(overrides = {}) {
  return {
    ROUND_DIRECT_E2E_ENABLED: 'true',
    ROUND_DIRECT_E2E_ENV: 'preview',
    ROUND_DIRECT_E2E_RUN_ID: runId,
    FIREBASE_PROJECT_ID: 'green-staging-74557',
    FIREBASE_STORAGE_BUCKET: 'green-staging-74557-e2e.appspot.com',
    ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: 'green-staging-74557',
    ROUND_DIRECT_E2E_ALLOWED_STORAGE_BUCKETS: 'green-staging-74557-e2e.appspot.com',
    ...overrides,
  };
}

function memoryAdapter({ failAfter = Number.POSITIVE_INFINITY } = {}) {
  const docs = new Map();
  const objects = new Map();
  const deletedDocs = [];
  const deletedObjects = [];
  let writes = 0;
  return {
    docs,
    objects,
    deletedDocs,
    deletedObjects,
    async getDoc(docPath) {
      return docs.get(docPath) ?? null;
    },
    async setDoc(docPath, data) {
      writes += 1;
      if (writes > failAfter) throw new Error('부분 seed 실패');
      docs.set(docPath, structuredClone(data));
    },
    async setObject(objectName, content) {
      objects.set(objectName, Buffer.from(content));
    },
    async deleteDoc(docPath) {
      deletedDocs.push(docPath);
      docs.delete(docPath);
    },
    async getObject(objectName) {
      return objects.get(objectName) ?? null;
    },
    async deleteObject(objectName) {
      deletedObjects.push(objectName);
      objects.delete(objectName);
    },
  };
}

describe('회차 E2E fixture 환경 안전 계약', () => {
  it('명시된 비운영 project와 bucket만 허용한다', () => {
    assert.deepEqual(validateFixtureEnvironment(validEnvironment()), {
      runId,
      projectId: 'green-staging-74557',
      storageBucket: 'green-staging-74557-e2e.appspot.com',
      storagePrefix: `e2e/round-direct/${runId}/`,
    });
  });

  it('운영 project·bucket과 운영 디어오키드 store를 거부한다', () => {
    assert.throws(
      () =>
        validateFixtureEnvironment(
          validEnvironment({
            FIREBASE_PROJECT_ID: 'green-e4fe3',
            ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: 'green-e4fe3',
          }),
        ),
      /운영 Firebase/,
    );
    assert.throws(
      () =>
        validateFixtureEnvironment(
          validEnvironment({
            FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com',
            ROUND_DIRECT_E2E_ALLOWED_STORAGE_BUCKETS: 'green-e4fe3.appspot.com',
          }),
        ),
      /운영 Storage/,
    );
  });
});

describe('회차 E2E fixture manifest 계약', () => {
  it('chromium과 mobile의 모든 문서·객체·계정을 분리한다', () => {
    const chromium = buildFixtureManifest({ runId, project: 'chromium', accounts });
    const mobile = buildFixtureManifest({
      runId,
      project: 'mobile',
      accounts: {
        consumer: { email: 'consumer-mobile@example.test', passwordHash: 'hash-consumer-mobile' },
        seller: { email: 'seller-mobile@example.test', passwordHash: 'hash-seller-mobile' },
        driver: { email: 'driver-mobile@example.test', passwordHash: 'hash-driver-mobile' },
      },
    });
    const chromiumPaths = new Set(chromium.documents.map(({ path }) => path));
    const mobilePaths = new Set(mobile.documents.map(({ path }) => path));
    assert.equal([...chromiumPaths].some((docPath) => mobilePaths.has(docPath)), false);
    assert.notEqual(chromium.storeId, mobile.storeId);
    assert.notDeepEqual(chromium.accountEmails, mobile.accountEmails);
  });

  it('별도 round_direct store와 회차·상품·계정·주문·사진 metadata를 포함한다', () => {
    const manifest = buildFixtureManifest({ runId, project: 'chromium', accounts });
    const collections = new Set(manifest.documents.map(({ path: docPath }) => docPath.split('/')[0]));
    for (const required of [
      'stores',
      'products',
      'saleRounds',
      'saleRoundItems',
      'users',
      'orders',
      'payments',
      'operationIssues',
      'legalOrderRecords',
      'e2eFixtureRuns',
    ]) {
      assert.ok(collections.has(required), `${required} fixture가 필요합니다.`);
    }
    const store = manifest.documents.find(({ path: docPath }) => docPath === `stores/${manifest.storeId}`);
    assert.equal(store.data.salesMode, 'round_direct');
    assert.notEqual(manifest.storeId, '80189070-2c3d-45f2-bc11-68a870b13951');

    const roundItem = manifest.documents.find(({ path: docPath }) =>
      docPath.endsWith('-round-open-item-1'),
    );
    assert.equal(roundItem.data.productImageUrlSnapshot, 'https://placehold.co/600x600.jpg');
    assert.equal('imageUrlSnapshot' in roundItem.data, false);

    const heldOrder = manifest.documents.find(({ path: docPath }) =>
      docPath.endsWith('-round-direct-order-held'),
    );
    assert.equal(heldOrder.data.deliveryMethod, 'direct');
    assert.equal(heldOrder.data.saleType, 'normal');
    assert.equal(heldOrder.data.deliveryFee, 0);
    assert.equal(heldOrder.data.orderItems.length, 2);
    assert.equal(heldOrder.data.deliveryHold.customerResponsible, true);
    assert.equal(typeof heldOrder.data.deliveryHold.reasonMessage, 'string');
    assert.match(heldOrder.data.orderNumber, /^\d{8}-\d{6}$/);
    assert.equal(manifest.generatedDocuments.length, 1);
    assert.equal(manifest.generatedStorageObjects.length, 1);
  });
});

describe('회차 E2E fixture seed·verify·cleanup 계약', () => {
  it('같은 manifest seed를 반복해도 동일하고 verify가 통과한다', async () => {
    const manifest = buildFixtureManifest({ runId, project: 'chromium', accounts });
    const adapter = memoryAdapter();
    await seedFixture(adapter, manifest);
    await seedFixture(adapter, manifest);
    const result = await verifyFixture(adapter, manifest);
    assert.equal(result.ready, true);
    assert.equal(result.missingDocuments.length, 0);
    assert.equal(result.missingObjects.length, 0);
  });

  it('부분 seed 실패 시 이미 생성한 manifest 범위만 cleanup한다', async () => {
    const manifest = buildFixtureManifest({ runId, project: 'chromium', accounts });
    const adapter = memoryAdapter({ failAfter: 3 });
    adapter.docs.set('stores/unrelated', { keep: true });
    await assert.rejects(seedFixture(adapter, manifest), /부분 seed 실패/);
    assert.deepEqual(adapter.docs.get('stores/unrelated'), { keep: true });
    for (const { path: docPath } of manifest.documents) {
      assert.equal(adapter.docs.has(docPath), false);
    }
  });

  it('cleanup은 manifest의 정확한 문서와 Storage 객체만 삭제하고 결과를 검증한다', async () => {
    const manifest = buildFixtureManifest({ runId, project: 'chromium', accounts });
    const adapter = memoryAdapter();
    await seedFixture(adapter, manifest);
    const generatedDocument = manifest.generatedDocuments[0];
    adapter.docs.set(generatedDocument.path, { ...generatedDocument.identity });
    adapter.objects.set(manifest.generatedStorageObjects[0], Buffer.from('generated-jpeg'));
    adapter.objects.set('e2e/round-direct/other-run/keep.jpg', Buffer.from('keep'));
    await cleanupFixture(adapter, manifest);
    const result = await verifyFixture(adapter, manifest, { expectAbsent: true });
    assert.equal(result.ready, true);
    assert.equal(adapter.objects.has('e2e/round-direct/other-run/keep.jpg'), true);
    assert.deepEqual(
      adapter.deletedObjects,
      [...manifest.storageObjects, ...manifest.generatedStorageObjects],
    );
    assert.equal(adapter.docs.has(generatedDocument.path), false);
  });
});
