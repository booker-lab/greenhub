import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCTION_PROJECT = 'green-e4fe3';
const PRODUCTION_STORE = '80189070-2c3d-45f2-bc11-68a870b13951';
const PROJECTS = new Set(['chromium', 'mobile']);
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{6,46}[a-z0-9]$/;

function list(value) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function validateFixtureEnvironment(env) {
  if (env.ROUND_DIRECT_E2E_ENABLED !== 'true' || env.ROUND_DIRECT_E2E_ENV !== 'preview') {
    throw new Error('회차 E2E Preview가 명시적으로 활성화되지 않았습니다.');
  }
  const runId = String(env.ROUND_DIRECT_E2E_RUN_ID ?? '').trim();
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('회차 E2E 실행 ID가 올바르지 않습니다.');
  const projectId = String(env.FIREBASE_PROJECT_ID ?? '').trim();
  if (projectId === PRODUCTION_PROJECT) throw new Error('운영 Firebase project는 사용할 수 없습니다.');
  if (!projectId || !list(env.ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS).includes(projectId)) {
    throw new Error('Firebase project가 비운영 허용 목록과 다릅니다.');
  }
  const storageBucket = String(env.FIREBASE_STORAGE_BUCKET ?? '').trim();
  if (storageBucket.toLowerCase().includes(PRODUCTION_PROJECT)) {
    throw new Error('운영 Storage bucket은 사용할 수 없습니다.');
  }
  if (!storageBucket || !list(env.ROUND_DIRECT_E2E_ALLOWED_STORAGE_BUCKETS).includes(storageBucket)) {
    throw new Error('Storage bucket이 비운영 허용 목록과 다릅니다.');
  }
  return {
    runId,
    projectId,
    storageBucket,
    storagePrefix: `e2e/round-direct/${runId}/`,
  };
}

function scheduleFor(status) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (status === 'OPEN') {
    return {
      orderOpenAt: new Date(now - day).toISOString(),
      orderCloseAt: new Date(now + day).toISOString(),
      auctionAt: new Date(now + day * 2).toISOString(),
      deliveryStartAt: new Date(now + day * 3).toISOString(),
      deliveryEndAt: new Date(now + day * 3 + 9 * 60 * 60 * 1000).toISOString(),
      timezone: 'Asia/Seoul',
    };
  }
  return {
    orderOpenAt: new Date(now - day * 7).toISOString(),
    orderCloseAt: new Date(now - day * 3).toISOString(),
    auctionAt: new Date(now - day * 2).toISOString(),
    deliveryStartAt: new Date(now - day).toISOString(),
    deliveryEndAt: new Date(now - day + 9 * 60 * 60 * 1000).toISOString(),
    timezone: 'Asia/Seoul',
  };
}

function roundDocument(id, storeId, status, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id,
    storeId,
    name: `E2E ${id.split('-').slice(-2).join(' ')}`,
    status,
    closeReason: status === 'CLOSED' || status === 'COMPLETED' ? 'MANUAL' : null,
    cancellation: null,
    schedule: scheduleFor(status),
    deliveryRegion: {
      id: 'icheon',
      label: '경기도 이천시',
      province: '경기도',
      city: '이천시',
      enabled: true,
    },
    limits: { maxDeliveryAddresses: 100, maxItemQuantity: 300 },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
    carrotLandingUrl: null,
    cancelledAt: null,
    completedAt: status === 'COMPLETED' ? now : null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function orderDocument(id, storeId, roundId, consumerId, driverId, status, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id,
    orderNumber: `E2E-${id.slice(-12)}`,
    schemaVersion: 2,
    storeId,
    roundId,
    userId: consumerId,
    driverId,
    status,
    deliveryMethod: 'DIRECT',
    deliveryType: 'DIRECT',
    address: '경기도 이천시 테스트로 1',
    phone: '01000000000',
    orderItems: [
      {
        roundItemId: `${roundId}-item-1`,
        productId: `${storeId}-product-1`,
        productName: 'E2E 호접란',
        quantity: 1,
        unitPrice: 12000,
        subtotalAmount: 12000,
      },
    ],
    totalAmount: 12000,
    deliveryPhotoIds: status === 'DELIVERED' ? [`${id}-photo`] : [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function buildFixtureManifest({ runId, project, accounts }) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('fixture 실행 ID가 올바르지 않습니다.');
  if (!PROJECTS.has(project)) throw new Error('fixture project는 chromium 또는 mobile이어야 합니다.');
  for (const role of ['consumer', 'seller', 'driver']) {
    if (!accounts?.[role]?.email || !accounts?.[role]?.passwordHash) {
      throw new Error(`${project} ${role} 계정 입력이 누락되었습니다.`);
    }
  }
  const namespace = `round-direct-e2e-${runId}-${project}`;
  const storeId = `${namespace}-store`;
  if (storeId === PRODUCTION_STORE) throw new Error('운영 디어오키드 store는 사용할 수 없습니다.');
  const ids = {
    consumer: `${namespace}-consumer`,
    seller: `${namespace}-seller`,
    driver: `${namespace}-driver`,
    product: `${namespace}-product-1`,
    openRound: `${namespace}-round-open`,
  };
  const tag = { runId, project, namespace };
  const documents = [];
  const add = (collection, id, data) => {
    documents.push({ path: `${collection}/${id}`, data: { ...data, _e2e: tag } });
  };

  add('users', ids.consumer, {
    id: ids.consumer, email: accounts.consumer.email, name: 'E2E 소비자', role: 'consumer',
    passwordHash: accounts.consumer.passwordHash, providers: ['email'], savedAddresses: [],
  });
  add('users', ids.seller, {
    id: ids.seller, email: accounts.seller.email, name: 'E2E 셀러', role: 'seller',
    storeId, passwordHash: accounts.seller.passwordHash, providers: ['email'],
  });
  add('users', ids.driver, {
    id: ids.driver, email: accounts.driver.email, name: 'E2E 드라이버', role: 'driver',
    driverApproved: true, passwordHash: accounts.driver.passwordHash, providers: ['email'],
  });
  add('stores', storeId, {
    id: storeId, ownerId: ids.seller, name: `E2E 회차 직배송 ${project}`,
    salesMode: 'round_direct', isActive: true, status: 'ACTIVE',
  });
  add('products', ids.product, {
    id: ids.product, storeId, sellerId: ids.seller, name: 'E2E 호접란',
    price: 12000, status: 'ACTIVE', isActive: true, stock: 300,
    images: ['https://placehold.co/600x600.jpg'], thumbnailUrl: 'https://placehold.co/600x600.jpg',
  });

  const roundDefinitions = [
    ['round-open', 'OPEN', {}],
    ['seller-round-copy-source-completed', 'COMPLETED', {}],
    ['seller-round-schedule-draft', 'DRAFT', {}],
    ['seller-round-close-open', 'OPEN', {}],
    ['seller-round-complete-blocked-held', 'CLOSED', {
      counters: {
        reservedDeliveryAddresses: 0, reservedItemQuantity: 0,
        orderedDeliveryAddresses: 1, orderedItemQuantity: 1, heldOrderCount: 1,
      },
    }],
    ['seller-round-complete-ready', 'CLOSED', {}],
    ['seller-round-confirmation-required', 'CLOSED', {}],
  ];
  for (const [suffix, status, overrides] of roundDefinitions) {
    const roundId = `${namespace}-${suffix}`;
    add('saleRounds', roundId, roundDocument(roundId, storeId, status, overrides));
    add('saleRoundItems', `${roundId}-item-1`, {
      id: `${roundId}-item-1`, roundId, storeId, productId: ids.product,
      productNameSnapshot: 'E2E 호접란', imageUrlSnapshot: 'https://placehold.co/600x600.jpg',
      roundPrice: 12000, saleLimitQuantity: 300, displayOrder: 1,
      reservedQuantity: 0, orderedQuantity: 0, status: 'ACTIVE',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }

  const driverOrders = [
    ['driver-round-direct-board', 'PREPARING', {}],
    ['driver-round-hub-excluded', 'PREPARING', { deliveryMethod: 'HUB' }],
    ['driver-round-parcel-excluded', 'PREPARING', { deliveryMethod: 'PARCEL' }],
    ['driver-round-direct-start-preparing', 'PREPARING', {}],
    ['driver-round-direct-hold-weather', 'DELIVERING', {}],
    ['driver-round-direct-hold-access', 'DELIVERING', {}],
    ['driver-round-direct-hold-address', 'DELIVERING', {}],
    ['driver-round-direct-hold-unreachable', 'DELIVERING', {}],
    ['driver-round-direct-resume-held', 'DELIVERY_HELD', {
      deliveryHold: {
        reasonCode: 'ACCESS_UNAVAILABLE', reason: '출입 정보 확인 필요',
        customerFault: true, redeliveryFee: 3000,
        nextContactAt: new Date(Date.now() + 3600000).toISOString(),
        nextDeliveryAt: new Date(Date.now() + 7200000).toISOString(),
      },
    }],
    ['driver-round-direct-photo-required', 'DELIVERING', {}],
  ];
  for (const [suffix, status, overrides] of driverOrders) {
    const orderId = `${namespace}-${suffix}`;
    add('orders', orderId, orderDocument(
      orderId, storeId, ids.openRound, ids.consumer, ids.driver, status, overrides,
    ));
  }

  const consumerOrders = [
    ['round-direct-order-held', 'DELIVERY_HELD', {
      deliveryHold: {
        reasonCode: 'ACCESS_UNAVAILABLE', reason: '출입 정보 확인 필요',
        customerFault: true, redeliveryFee: 3000,
      },
    }],
    ['round-direct-order-delivered', 'DELIVERED', {}],
    ['round-direct-order-accepted', 'ACCEPTED', {}],
  ];
  for (const [suffix, status, overrides] of consumerOrders) {
    const orderId = `${namespace}-${suffix}`;
    add('orders', orderId, orderDocument(
      orderId, storeId, ids.openRound, ids.consumer, ids.driver, status, overrides,
    ));
    add('payments', orderId, {
      id: orderId, orderId, userId: ids.consumer, amount: 12000,
      portonePaymentId: orderId, status: 'PAID', createdAt: new Date().toISOString(),
    });
  }
  add('operationIssues', `${namespace}-issue-notice`, {
    id: `${namespace}-issue-notice`, storeId, orderId: `${namespace}-round-direct-order-held`,
    type: 'CUSTOMER_NOTICE_FAILED', status: 'OPEN', idempotencyKey: `${namespace}-notice`,
  });
  add('operationIssues', `${namespace}-issue-refund`, {
    id: `${namespace}-issue-refund`, storeId, orderId: `${namespace}-round-direct-order-held`,
    type: 'AUTO_REFUND_FAILED', status: 'OPEN', idempotencyKey: `${namespace}-refund`,
  });
  add('legalOrderRecords', `${namespace}-delivery-photo`, {
    id: `${namespace}-delivery-photo`, storeId,
    orderId: `${namespace}-round-direct-order-delivered`,
    purpose: 'DELIVERY_PHOTO', storagePath: `${namespace}/delivery-photo-placeholder.jpg`,
    expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
  });
  add('e2eFixtureRuns', `${namespace}-complete`, {
    id: `${namespace}-complete`, runId, project, status: 'SEEDED',
    documentCount: documents.length + 1, completedAt: new Date().toISOString(),
  });

  return {
    version: 1,
    runId,
    project,
    namespace,
    storeId,
    accountEmails: Object.fromEntries(
      Object.entries(accounts).map(([role, account]) => [role, account.email]),
    ),
    documents,
    storageObjects: [`e2e/round-direct/${runId}/${project}/round-direct-delivery.jpg`],
  };
}

function assertManifest(manifest) {
  if (!RUN_ID_PATTERN.test(manifest?.runId) || !PROJECTS.has(manifest?.project)) {
    throw new Error('fixture manifest 식별자가 올바르지 않습니다.');
  }
  const namespace = `round-direct-e2e-${manifest.runId}-${manifest.project}`;
  if (manifest.namespace !== namespace || !manifest.storeId.startsWith(`${namespace}-`)) {
    throw new Error('fixture manifest namespace가 올바르지 않습니다.');
  }
  for (const entry of manifest.documents ?? []) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(entry.path)) {
      throw new Error('manifest 문서 경로가 올바르지 않습니다.');
    }
    if (entry.data?._e2e?.runId !== manifest.runId || entry.data?._e2e?.project !== manifest.project) {
      throw new Error('manifest 문서 소유 표식이 올바르지 않습니다.');
    }
  }
  const prefix = `e2e/round-direct/${manifest.runId}/${manifest.project}/`;
  if (!(manifest.storageObjects ?? []).every((name) => name.startsWith(prefix))) {
    throw new Error('manifest Storage 객체가 실행 접두사 밖입니다.');
  }
}

export async function seedFixture(adapter, manifest) {
  assertManifest(manifest);
  try {
    for (const entry of manifest.documents) {
      const existing = await adapter.getDoc(entry.path);
      if (
        existing &&
        (existing._e2e?.runId !== manifest.runId || existing._e2e?.project !== manifest.project)
      ) {
        throw new Error(`다른 소유자의 fixture 문서가 존재합니다: ${entry.path}`);
      }
      await adapter.setDoc(entry.path, entry.data);
    }
  } catch (error) {
    await cleanupFixture(adapter, manifest);
    throw error;
  }
}

export async function verifyFixture(adapter, manifest, { expectAbsent = false } = {}) {
  assertManifest(manifest);
  const missingDocuments = [];
  const remainingDocuments = [];
  for (const entry of manifest.documents) {
    const data = await adapter.getDoc(entry.path);
    if (expectAbsent ? data : !data) {
      (expectAbsent ? remainingDocuments : missingDocuments).push(entry.path);
    }
  }
  const remainingObjects = [];
  if (expectAbsent) {
    for (const objectName of manifest.storageObjects) {
      if (await adapter.getObject(objectName)) remainingObjects.push(objectName);
    }
  }
  return {
    ready:
      expectAbsent
        ? remainingDocuments.length === 0 && remainingObjects.length === 0
        : missingDocuments.length === 0,
    missingDocuments,
    remainingDocuments,
    remainingObjects,
  };
}

export async function cleanupFixture(adapter, manifest) {
  assertManifest(manifest);
  for (const objectName of manifest.storageObjects) await adapter.deleteObject(objectName);
  for (const entry of [...manifest.documents].reverse()) {
    const existing = await adapter.getDoc(entry.path);
    if (
      existing?._e2e?.runId === manifest.runId &&
      existing?._e2e?.project === manifest.project
    ) {
      await adapter.deleteDoc(entry.path);
    }
  }
}

async function firebaseAdapter(environment) {
  const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawCredential) throw new Error('비운영 FIREBASE_SERVICE_ACCOUNT_JSON이 필요합니다.');
  const serviceAccount = JSON.parse(rawCredential);
  if (serviceAccount.project_id !== environment.projectId) {
    throw new Error('서비스 계정 project와 비운영 대상 project가 다릅니다.');
  }
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getStorage } = await import('firebase-admin/storage');
  const app = initializeApp({
    credential: cert(serviceAccount),
    projectId: environment.projectId,
    storageBucket: environment.storageBucket,
  }, `round-direct-${environment.runId}-${Date.now()}`);
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket(environment.storageBucket);
  return {
    async getDoc(docPath) {
      const snapshot = await db.doc(docPath).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async setDoc(docPath, data) {
      await db.doc(docPath).set(data);
    },
    async deleteDoc(docPath) {
      await db.doc(docPath).delete();
    },
    async getObject(objectName) {
      const [exists] = await bucket.file(objectName).exists();
      return exists ? { exists: true } : null;
    },
    async deleteObject(objectName) {
      await bucket.file(objectName).delete({ ignoreNotFound: true });
    },
  };
}

function argument(name) {
  return process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

async function main() {
  const action = process.argv[2];
  if (!['seed', 'verify', 'cleanup'].includes(action)) {
    throw new Error('사용법: node scripts/round-direct-e2e-fixtures.mjs seed|verify|cleanup --project=chromium|mobile --manifest=<경로>');
  }
  const environment = validateFixtureEnvironment(process.env);
  const project = argument('project');
  const manifestPath = path.resolve(argument('manifest') ?? '');
  if (!PROJECTS.has(project) || !manifestPath.replaceAll('\\', '/').includes(`/${environment.runId}/`)) {
    throw new Error('project 또는 manifest 경로가 실행 범위와 다릅니다.');
  }
  let manifest;
  if (action === 'seed') {
    const suffix = project.toUpperCase();
    const bcrypt = await import('bcrypt');
    const accounts = {};
    for (const role of ['CONSUMER', 'SELLER', 'DRIVER']) {
      const email = process.env[`TEST_${role}_EMAIL_${suffix}`];
      const password = process.env[`TEST_${role}_PASSWORD_${suffix}`];
      if (!email || !password) throw new Error(`${project} ${role} 계정 자격이 필요합니다.`);
      accounts[role.toLowerCase()] = { email, passwordHash: await bcrypt.hash(password, 12) };
    }
    manifest = buildFixtureManifest({ runId: environment.runId, project, accounts });
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  } else {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  const adapter = await firebaseAdapter(environment);
  if (action === 'seed') await seedFixture(adapter, manifest);
  const result =
    action === 'cleanup'
      ? (await cleanupFixture(adapter, manifest), await verifyFixture(adapter, manifest, { expectAbsent: true }))
      : await verifyFixture(adapter, manifest);
  process.stdout.write(`${JSON.stringify({ action, runId: manifest.runId, project, ...result }, null, 2)}\n`);
  if (!result.ready) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(`회차 E2E fixture 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
