import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFixtureCli } from './round-direct-e2e-fixtures-cli.mjs';
import {
  evaluateFirebaseTarget,
  inspectFirebaseServiceAccount,
} from './check-round-direct-e2e-readiness.mjs';
const PRODUCTION_STORE = '80189070-2c3d-45f2-bc11-68a870b13951';
const PROJECTS = new Set(['chromium', 'mobile', 'generic']);
const ROUND_DIRECT_PROJECTS = new Set(['chromium', 'mobile']);
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{6,46}[a-z0-9]$/;
const ROUND_DIRECT_DELIVERY_JPEG = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/e2e/fixtures/round-direct-delivery.jpg'));
function list(value) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function validateFixtureEnvironment(env, { requireServiceAccount = false } = {}) {
  const previewHarnessEnabled =
    env.ROUND_DIRECT_E2E_ENABLED === 'true' || env.PREVIEW_E2E_HARNESS_ENABLED === 'true';
  if (!previewHarnessEnabled || env.ROUND_DIRECT_E2E_ENV !== 'preview') {
    throw new Error('비운영 Preview E2E harness가 명시적으로 활성화되지 않았습니다.');
  }
  const runId = String(env.ROUND_DIRECT_E2E_RUN_ID ?? '').trim();
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('회차 E2E 실행 ID가 올바르지 않습니다.');
  const target = evaluateFirebaseTarget(
    {
      firebaseProjectId: env.FIREBASE_PROJECT_ID,
      allowedFirebaseProjects: list(env.ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS),
      serviceAccount: inspectFirebaseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON),
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      allowedStorageBuckets: list(env.ROUND_DIRECT_E2E_ALLOWED_STORAGE_BUCKETS),
    },
    { requireServiceAccount },
  );
  if (!target.ready) {
    throw new Error(
      `Firebase fixture target가 준비되지 않았습니다: ${target.failures
        .map(({ code, message }) => `${code}(${message})`)
        .join(', ')}`,
    );
  }
  return {
    runId,
    projectId: target.firebaseProjectId,
    storageBucket: target.storageBucket,
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
  const compactTimestamp = now.replace(/\D/g, '').slice(0, 14);
  const namespace = storeId.replace(/-store$/, '');
  return {
    id,
    orderNumber: `${compactTimestamp.slice(0, 8)}-${compactTimestamp.slice(8)}`,
    schemaVersion: 2,
    storeId,
    roundId,
    userId: consumerId,
    driverId,
    status,
    saleType: 'normal',
    deliveryMethod: 'direct',
    deliveryType: 'DIRECT',
    address: '경기도 이천시 테스트로 1',
    deliveryAddress: { address: '경기도 이천시 테스트로 1', addressDetail: '' },
    deliveryPhone: '01000000000',
    requestedDeliveryDate: null,
    buyerName: 'E2E 소비자',
    buyerPhone: '01000000000',
    sellerPhone: '01000000001',
    productName: 'E2E 호접란',
    quantity: 2,
    orderItems: [
      {
        roundItemId: `${roundId}-item-1`,
        productId: `${namespace}-product-1`,
        productName: 'E2E 호접란',
        quantity: 1,
        unitPrice: 6000,
        subtotalAmount: 6000,
      },
      {
        roundItemId: `${roundId}-item-2`,
        productId: `${namespace}-product-2`,
        productName: 'E2E 미니 호접란',
        quantity: 1,
        unitPrice: 6000,
        subtotalAmount: 6000,
      },
    ],
    deliveryFee: 0,
    totalAmount: 12000,
    deliveryPhotoIds: status === 'DELIVERED' ? [`${id}-photo`] : [],
    ...(status === 'PREPARING'
      ? { preparedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } }
      : {}),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildOwnershipManifest({
  documents,
  storageObjects,
  generatedDocuments,
  generatedStorageObjects,
}) {
  return {
    IMMUTABLE_BASELINE: {
      documents: [],
      storageObjects: [],
    },
    RUN_OWNED_MUTABLE: {
      documents: documents.map(({ path: documentPath }) => documentPath),
      storageObjects: [...storageObjects],
    },
    SPEC_OWNED_TEMPORARY: {
      documents: generatedDocuments.map(({ path: documentPath }) => documentPath),
      storageObjects: [...generatedStorageObjects],
    },
  };
}

export function buildFixtureManifest({ runId, project, accounts }) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('fixture 실행 ID가 올바르지 않습니다.');
  if (!ROUND_DIRECT_PROJECTS.has(project)) {
    throw new Error('round-direct fixture project는 chromium 또는 mobile이어야 합니다.');
  }
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
    secondProduct: `${namespace}-product-2`,
    closedProduct: `${namespace}-product-closed`,
    openRound: `${namespace}-round-open`,
  };
  const tag = { runId, project, namespace };
  const linkedRedeliveryHoldAt = '2026-08-26T00:00:00.000Z';
  const driverResumeChargeId = `${namespace}-driver-round-direct-resume-held-charge`;
  const consumerHeldChargeId = `${namespace}-round-direct-order-held-charge`;
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
  add('products', ids.secondProduct, {
    id: ids.secondProduct, storeId, sellerId: ids.seller, name: 'E2E 미니 호접란',
    price: 6000, status: 'ACTIVE', isActive: true, stock: 300,
    images: ['https://placehold.co/600x600.jpg'], thumbnailUrl: 'https://placehold.co/600x600.jpg',
  });
  add('products', ids.closedProduct, {
    id: ids.closedProduct, storeId, sellerId: ids.seller, name: 'E2E 마감 호접란',
    price: 9000, status: 'ACTIVE', isActive: false, stock: 300,
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
    ['seller-round-confirmation-required', 'CLOSED', {
      counters: {
        reservedDeliveryAddresses: 0, reservedItemQuantity: 0,
        orderedDeliveryAddresses: 1, orderedItemQuantity: 1, heldOrderCount: 1,
      },
      cancellation: {
        status: 'LOCAL_FAILED', reason: 'E2E 확인 필요', failedOrderId: null,
        updatedAt: new Date().toISOString(), completedAt: null,
      },
    }],
  ];
  for (const [suffix, status, overrides] of roundDefinitions) {
    const roundId = `${namespace}-${suffix}`;
    add('saleRounds', roundId, roundDocument(roundId, storeId, status, overrides));
    add('saleRoundItems', `${roundId}-item-1`, {
      id: `${roundId}-item-1`, roundId, storeId, productId: ids.product,
      productNameSnapshot: 'E2E 호접란',
      productImageUrlSnapshot: 'https://placehold.co/600x600.jpg',
      roundPrice: 12000, saleLimitQuantity: 300, displayOrder: 1,
      reservedQuantity: 0, orderedQuantity: 0, status: 'ACTIVE',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    if (suffix === 'round-open') {
      add('saleRoundItems', `${roundId}-item-2`, {
        id: `${roundId}-item-2`, roundId, storeId, productId: ids.secondProduct,
        productNameSnapshot: 'E2E 미니 호접란',
        productImageUrlSnapshot: 'https://placehold.co/600x600.jpg',
        roundPrice: 6000, saleLimitQuantity: 300, displayOrder: 2,
        reservedQuantity: 0, orderedQuantity: 0, status: 'ACTIVE',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      add('saleRoundItems', `${roundId}-item-closed`, {
        id: `${roundId}-item-closed`, roundId, storeId, productId: ids.closedProduct,
        productNameSnapshot: 'E2E 마감 호접란',
        productImageUrlSnapshot: 'https://placehold.co/600x600.jpg',
        roundPrice: 9000, saleLimitQuantity: 300, displayOrder: 3,
        reservedQuantity: 0, orderedQuantity: 0, status: 'HIDDEN',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }
  }

  const driverOrders = [
    ['driver-round-direct-board', 'PREPARING', {}],
    ['driver-round-hub-excluded', 'PREPARING', { deliveryMethod: 'hub' }],
    ['driver-round-parcel-excluded', 'PREPARING', { deliveryMethod: 'parcel' }],
    ['driver-round-direct-start-preparing', 'PREPARING', {}],
    ['driver-round-direct-hold-weather', 'DELIVERING', {}],
    ['driver-round-direct-hold-access', 'DELIVERING', {}],
    ['driver-round-direct-hold-address', 'DELIVERING', {}],
    ['driver-round-direct-hold-unreachable', 'DELIVERING', {}],
    ['driver-round-direct-resume-held', 'DELIVERY_HELD', {
      deliveryHold: {
        heldAt: linkedRedeliveryHoldAt,
        reasonCode: 'ACCESS_UNAVAILABLE', reasonMessage: '출입 정보 확인 필요',
        customerResponsible: true, redeliveryFee: 3000,
        nextContactAt: new Date(Date.now() + 3600000).toISOString(),
        nextDeliveryAt: new Date(Date.now() + 7200000).toISOString(),
        resolvedAt: null,
      },
      redeliveryChargeId: driverResumeChargeId,
      redeliveryChargeHoldAt: linkedRedeliveryHoldAt,
    }],
    ['driver-round-direct-photo-required', 'DELIVERING', {}],
  ];
  for (const [suffix, status, overrides] of driverOrders) {
    const orderId = `${namespace}-${suffix}`;
    add('orders', orderId, orderDocument(
      orderId, storeId, ids.openRound, ids.consumer, ids.driver, status, overrides,
    ));
    if (suffix === 'driver-round-direct-resume-held') {
      add('orderCharges', driverResumeChargeId, {
        id: driverResumeChargeId,
        orderId,
        storeId,
        userId: ids.consumer,
        type: 'REDELIVERY_FEE',
        status: 'PAID',
        amount: 3000,
        customerResponsible: true,
        holdAt: linkedRedeliveryHoldAt,
        portonePaymentId: `${namespace}-driver-round-direct-resume-held-payment`,
        paidAt: new Date().toISOString(),
      });
    }
  }

  const blockedRoundId = `${namespace}-seller-round-complete-blocked-held`;
  const blockedOrderId = `${namespace}-seller-round-complete-blocked-order`;
  add('orders', blockedOrderId, orderDocument(
    blockedOrderId, storeId, blockedRoundId, ids.consumer, ids.driver, 'DELIVERY_HELD', {
      deliveryHold: {
        heldAt: new Date().toISOString(), reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '출입 정보 확인 필요', customerResponsible: true,
        redeliveryFee: 3000, nextContactAt: null, nextDeliveryAt: null,
      },
    },
  ));

  const consumerOrders = [
    ['round-direct-order-held', 'DELIVERY_HELD', {
      deliveryHold: {
        heldAt: linkedRedeliveryHoldAt,
        reasonCode: 'ACCESS_UNAVAILABLE', reasonMessage: '출입 정보 확인 필요',
        customerResponsible: true, redeliveryFee: 3000,
        nextContactAt: null, nextDeliveryAt: null,
        resolvedAt: null,
      },
      redeliveryChargeId: consumerHeldChargeId,
      redeliveryChargeHoldAt: linkedRedeliveryHoldAt,
    }],
    ['round-direct-order-delivered', 'DELIVERED', {}],
    ['round-direct-order-accepted', 'ACCEPTED', {}],
  ];
  for (const [suffix, status, overrides] of consumerOrders) {
    const orderId = `${namespace}-${suffix}`;
    add('orders', orderId, orderDocument(
      orderId, storeId, ids.openRound, ids.consumer, ids.driver, status, overrides,
    ));
    if (suffix === 'round-direct-order-held') {
      add('orderCharges', consumerHeldChargeId, {
        id: consumerHeldChargeId,
        orderId,
        storeId,
        userId: ids.consumer,
        type: 'REDELIVERY_FEE',
        status: 'PENDING',
        amount: 3000,
        customerResponsible: true,
        holdAt: linkedRedeliveryHoldAt,
        portonePaymentId: `${namespace}-round-direct-order-held-payment`,
        paidAt: null,
      });
    }
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
    purpose: 'DELIVERY_PHOTO',
    storagePath: `deliveryPhotos/${namespace}-round-direct-order-delivered/${namespace}-round-direct-order-delivered-photo.jpg`,
    expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
  });
  add('e2eFixtureRuns', `${namespace}-complete`, {
    id: `${namespace}-complete`, runId, project, status: 'SEEDED',
    documentCount: documents.length + 1, completedAt: new Date().toISOString(),
  });

  const deliveredOrderId = `${namespace}-round-direct-order-delivered`;
  const deliveredPhotoId = `${deliveredOrderId}-photo`;
  const uploadOrderId = `${namespace}-driver-round-direct-photo-required`;
  const uploadIdempotencyKey = `${namespace}-photo-upload`;
  const uploadPhotoId = createHash('sha256')
    .update(`${uploadOrderId}:${uploadIdempotencyKey}`)
    .digest('hex')
    .slice(0, 32);

  const storageObjects = [`deliveryPhotos/${deliveredOrderId}/${deliveredPhotoId}.jpg`];
  const generatedStorageObjects = [`deliveryPhotos/${uploadOrderId}/${uploadPhotoId}.jpg`];
  const generatedDocuments = [
    ...Object.values(ids)
      .filter((id) => id.endsWith('-consumer') || id.endsWith('-seller') || id.endsWith('-driver'))
      .map((userId) => ({
        path: `refreshTokens/${userId}`,
        kind: 'refreshToken',
        identity: { userId },
      })),
    {
      path: `deliveryPhotoRecords/${uploadOrderId}:${uploadPhotoId}`,
      kind: 'deliveryPhoto',
      identity: { orderId: uploadOrderId, photoId: uploadPhotoId },
    },
  ];

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
    storageObjects,
    generatedStorageObjects,
    generatedDocuments,
    ownership: buildOwnershipManifest({
      documents,
      storageObjects,
      generatedDocuments,
      generatedStorageObjects,
    }),
  };
}

function genericDateOffset(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function buildGenericPreviewFixtureManifest({ runId, accounts }) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('fixture 실행 ID가 올바르지 않습니다.');
  for (const role of ['consumer', 'seller']) {
    if (!accounts?.[role]?.email || !accounts?.[role]?.passwordHash) {
      throw new Error(`generic Preview ${role} 계정 입력이 누락되었습니다.`);
    }
  }

  const project = 'generic';
  const namespace = `preview-e2e-${runId}-${project}`;
  const storeId = `${namespace}-store`;
  const ids = {
    consumer: `${namespace}-consumer`,
    seller: `${namespace}-seller`,
    normalProduct: `${namespace}-normal-product`,
    groupProduct: `${namespace}-group-product`,
    normalOrder: `${namespace}-normal-order`,
    groupOrder: `${namespace}-group-order`,
    parcelOrder: `${namespace}-parcel-order`,
  };
  const now = new Date().toISOString();
  const normalDeliveryDate = genericDateOffset(2);
  const groupDeliveryDate = genericDateOffset(7);
  const documents = [];
  const tag = { runId, project };
  const add = (collection, id, data) => {
    documents.push({ path: `${collection}/${id}`, data: { ...data, _e2e: tag } });
  };

  add('users', ids.consumer, {
    id: ids.consumer,
    email: accounts.consumer.email,
    name: 'E2E 소비자',
    role: 'consumer',
    passwordHash: accounts.consumer.passwordHash,
    providers: ['email'],
    savedAddresses: [],
  });
  add('users', ids.seller, {
    id: ids.seller,
    email: accounts.seller.email,
    name: 'E2E 셀러',
    role: 'seller',
    storeId,
    passwordHash: accounts.seller.passwordHash,
    providers: ['email'],
  });
  add('stores', storeId, {
    id: storeId,
    ownerId: ids.seller,
    name: 'E2E Preview 테스트 꽃농장',
    ceoName: 'E2E 셀러',
    phone: '01000000001',
    address: '서울 테스트로 1',
    status: 'ACTIVE',
    isActive: true,
    salesMode: 'legacy',
  });
  add('products', ids.normalProduct, {
    id: ids.normalProduct,
    storeId,
    sellerId: ids.seller,
    name: 'E2E 일반 상품',
    description: 'generic Preview 주문 탭 검증용 일반 상품',
    images: [],
    price: 10000,
    category: 'cut_flower',
    colors: ['레드'],
    saleType: 'normal',
    deliverySize: 'small',
    isActive: true,
    stock: 300,
    createdAt: now,
    updatedAt: now,
  });
  add('products', ids.groupProduct, {
    id: ids.groupProduct,
    storeId,
    sellerId: ids.seller,
    name: 'E2E 공구 상품',
    description: 'generic Preview 주문 탭 검증용 공동구매 상품',
    images: [],
    price: 15000,
    category: 'cut_flower',
    colors: ['핑크'],
    saleType: 'group',
    deliverySize: 'small',
    isActive: true,
    stock: 300,
    createdAt: now,
    updatedAt: now,
  });
  add('groupProductConfig', ids.groupProduct, {
    productId: ids.groupProduct,
    minQuantity: 5,
    targetQuantity: 20,
    maxPerPerson: 3,
    currentQuantity: 1,
    recruitDeadline: new Date(`${normalDeliveryDate}T00:00:00.000Z`).toISOString(),
    groupDeliveryDate: new Date(`${groupDeliveryDate}T00:00:00.000Z`).toISOString(),
    createdAt: now,
    updatedAt: now,
  });
  for (let offset = 0; offset < 14; offset += 1) {
    const date = genericDateOffset(offset);
    add('dailyCaps', `${storeId}_${date}`, {
      id: `${storeId}_${date}`,
      storeId,
      date,
      totalCap: 10,
      usedSlots: 0,
    });
  }

  const baseOrder = {
    storeId,
    userId: ids.consumer,
    buyerName: 'E2E 소비자',
    address: '서울 테스트로 1',
    buyerPhone: '01000000001',
    sellerPhone: '01000000001',
    hubName: null,
    hubAddress: null,
    quantity: 1,
    status: 'ACCEPTED',
    deliveryFee: 3000,
    deliveryAddress: { address: '서울 테스트로 1', addressDetail: '101호', zipCode: '12345' },
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: 13000,
    preparedAt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
  };
  add('orders', ids.normalOrder, {
    ...baseOrder,
    id: ids.normalOrder,
    orderNumber: '20260101-000001',
    productId: ids.normalProduct,
    productName: 'E2E 일반 상품',
    saleType: 'normal',
    deliveryMethod: 'direct',
    requestedDeliveryDate: normalDeliveryDate,
  });
  add('orders', ids.groupOrder, {
    ...baseOrder,
    id: ids.groupOrder,
    orderNumber: '20260101-000002',
    productId: ids.groupProduct,
    productName: 'E2E 공구 상품',
    saleType: 'group',
    deliveryMethod: 'direct',
    totalAmount: 18000,
    requestedDeliveryDate: null,
    groupBuyConsent: { agreed: true, agreedAt: now, userId: ids.consumer },
  });
  add('orders', ids.parcelOrder, {
    ...baseOrder,
    id: ids.parcelOrder,
    orderNumber: '20260101-000003',
    productId: ids.normalProduct,
    productName: 'E2E 일반 상품',
    saleType: 'normal',
    deliveryMethod: 'parcel',
    deliveryFee: 4000,
    totalAmount: 14000,
    requestedDeliveryDate: normalDeliveryDate,
    status: 'PREPARING',
    preparedAt: now,
  });

  const generatedDocuments = ['consumer', 'seller'].map((role) => ({
    path: `refreshTokens/${ids[role]}`,
    kind: 'refreshToken',
    identity: { userId: ids[role] },
  }));

  return {
    version: 1,
    fixtureKind: 'generic-preview',
    runId,
    project,
    namespace,
    storeId,
    accountEmails: Object.fromEntries(
      Object.entries(accounts).map(([role, account]) => [role, account.email]),
    ),
    documents,
    storageObjects: [],
    generatedStorageObjects: [],
    generatedDocuments,
    ownership: buildOwnershipManifest({
      documents,
      storageObjects: [],
      generatedDocuments,
      generatedStorageObjects: [],
    }),
  };
}

function assertManifest(manifest) {
  if (!RUN_ID_PATTERN.test(manifest?.runId) || !PROJECTS.has(manifest?.project)) {
    throw new Error('fixture manifest 식별자가 올바르지 않습니다.');
  }
  const namespace =
    manifest.fixtureKind === 'generic-preview'
      ? `preview-e2e-${manifest.runId}-generic`
      : `round-direct-e2e-${manifest.runId}-${manifest.project}`;
  if (
    (manifest.project === 'generic' && manifest.fixtureKind !== 'generic-preview') ||
    (manifest.project !== 'generic' && manifest.fixtureKind === 'generic-preview')
  ) {
    throw new Error('fixture manifest 종류와 project가 일치하지 않습니다.');
  }
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
  const storagePrefix = `deliveryPhotos/${namespace}-`;
  const allObjects = [...(manifest.storageObjects ?? []), ...(manifest.generatedStorageObjects ?? [])];
  if (manifest.fixtureKind === 'generic-preview' && allObjects.length > 0) {
    throw new Error('generic Preview fixture는 Storage 객체를 소유할 수 없습니다.');
  }
  if (!allObjects.every((name) => name.startsWith(storagePrefix))) {
    throw new Error('manifest Storage 객체가 실행 namespace 밖입니다.');
  }
  for (const entry of manifest.generatedDocuments ?? []) {
    if (entry.kind === 'refreshToken') {
      if (
        !entry.path.startsWith(`refreshTokens/${namespace}-`) ||
        entry.identity?.userId !== entry.path.split('/')[1]
      ) {
        throw new Error('manifest refresh token 문서가 실행 namespace 밖입니다.');
      }
      continue;
    }
    if (
      entry.kind !== 'deliveryPhoto' ||
      !entry.path.startsWith(`deliveryPhotoRecords/${namespace}-`) ||
      entry.identity?.orderId !== entry.path.split('/')[1]?.split(':')[0] ||
      !entry.identity?.photoId
    ) {
      throw new Error('manifest 생성 문서가 실행 namespace 밖입니다.');
    }
  }
  const ownership = manifest.ownership;
  const ownershipResources = ['IMMUTABLE_BASELINE', 'RUN_OWNED_MUTABLE', 'SPEC_OWNED_TEMPORARY']
    .flatMap((category) => {
      const bucket = ownership?.[category];
      return [
        ...(bucket?.documents ?? []).map((documentPath) => `document:${documentPath}`),
        ...(bucket?.storageObjects ?? []).map((objectName) => `storage:${objectName}`),
      ];
    });
  const expectedResources = [
    ...(manifest.documents ?? []).map(({ path: documentPath }) => `document:${documentPath}`),
    ...(manifest.generatedDocuments ?? []).map(({ path: documentPath }) => `document:${documentPath}`),
    ...(manifest.storageObjects ?? []).map((objectName) => `storage:${objectName}`),
    ...(manifest.generatedStorageObjects ?? []).map((objectName) => `storage:${objectName}`),
  ];
  if (
    ownershipResources.length !== new Set(ownershipResources).size ||
    ownershipResources.length !== expectedResources.length ||
    ownershipResources.some((resource) => !expectedResources.includes(resource)) ||
    expectedResources.some((resource) => !ownershipResources.includes(resource))
  ) {
    throw new Error('fixture ownership manifest가 모든 정확한 자원을 단일 category로 분류하지 않았습니다.');
  }
}

export async function seedFixture(adapter, manifest) {
  assertManifest(manifest);
  const runOwnedDocuments = new Set(manifest.ownership.RUN_OWNED_MUTABLE.documents);
  const runOwnedStorageObjects = new Set(manifest.ownership.RUN_OWNED_MUTABLE.storageObjects);
  try {
    for (const entry of manifest.documents) {
      if (!runOwnedDocuments.has(entry.path)) continue;
      const existing = await adapter.getDoc(entry.path);
      if (
        existing &&
        (existing._e2e?.runId !== manifest.runId || existing._e2e?.project !== manifest.project)
      ) {
        throw new Error(`다른 소유자의 fixture 문서가 존재합니다: ${entry.path}`);
      }
      await adapter.setDoc(entry.path, entry.data);
    }
    for (const objectName of manifest.storageObjects ?? []) {
      if (!runOwnedStorageObjects.has(objectName)) continue;
      await adapter.setObject(objectName, ROUND_DIRECT_DELIVERY_JPEG);
    }
  } catch (error) {
    await cleanupFixture(adapter, manifest);
    throw error;
  }
}

export async function verifyFixture(adapter, manifest, { expectAbsent = false } = {}) {
  assertManifest(manifest);
  const immutableDocuments = new Set(manifest.ownership.IMMUTABLE_BASELINE.documents);
  const immutableStorageObjects = new Set(manifest.ownership.IMMUTABLE_BASELINE.storageObjects);
  const specOwnedDocuments = new Set(manifest.ownership.SPEC_OWNED_TEMPORARY.documents);
  const specOwnedStorageObjects = new Set(manifest.ownership.SPEC_OWNED_TEMPORARY.storageObjects);
  const documentEntries = expectAbsent
    ? manifest.documents.filter(({ path: documentPath }) => !immutableDocuments.has(documentPath))
    : manifest.documents;
  const storageObjects = expectAbsent
    ? (manifest.storageObjects ?? []).filter((objectName) => !immutableStorageObjects.has(objectName))
    : manifest.storageObjects ?? [];
  const missingDocuments = [];
  const remainingDocuments = [];
  for (const entry of documentEntries) {
    const data = await adapter.getDoc(entry.path);
    if (expectAbsent ? data : !data) {
      (expectAbsent ? remainingDocuments : missingDocuments).push(entry.path);
    }
  }
  if (expectAbsent) {
    for (const entry of (manifest.generatedDocuments ?? []).filter(({ path: documentPath }) =>
      specOwnedDocuments.has(documentPath))) {
      if (await adapter.getDoc(entry.path)) remainingDocuments.push(entry.path);
    }
  }
  const missingObjects = [];
  const remainingObjects = [];
  for (const objectName of storageObjects) {
    const object = await adapter.getObject(objectName);
    if (expectAbsent ? object : !object) {
      (expectAbsent ? remainingObjects : missingObjects).push(objectName);
    }
  }
  if (expectAbsent) {
    for (const objectName of (manifest.generatedStorageObjects ?? []).filter((name) =>
      specOwnedStorageObjects.has(name))) {
      if (await adapter.getObject(objectName)) remainingObjects.push(objectName);
    }
  }
  return {
    ready:
      expectAbsent
        ? remainingDocuments.length === 0 && remainingObjects.length === 0
        : missingDocuments.length === 0 && missingObjects.length === 0,
    missingDocuments,
    missingObjects,
    remainingDocuments,
    remainingObjects,
  };
}

export async function cleanupFixture(adapter, manifest) {
  assertManifest(manifest);
  const runOwnedDocuments = new Set(manifest.ownership.RUN_OWNED_MUTABLE.documents);
  const runOwnedStorageObjects = new Set(manifest.ownership.RUN_OWNED_MUTABLE.storageObjects);
  const specOwnedDocuments = new Set(manifest.ownership.SPEC_OWNED_TEMPORARY.documents);
  const specOwnedStorageObjects = new Set(manifest.ownership.SPEC_OWNED_TEMPORARY.storageObjects);
  for (const objectName of [
    ...(manifest.storageObjects ?? []),
    ...(manifest.generatedStorageObjects ?? []),
  ].filter((objectName) => runOwnedStorageObjects.has(objectName) || specOwnedStorageObjects.has(objectName))) {
    await adapter.deleteObject(objectName);
  }
  for (const entry of (manifest.generatedDocuments ?? []).filter(({ path: documentPath }) =>
    specOwnedDocuments.has(documentPath))) {
    const existing = await adapter.getDoc(entry.path);
    let owned = false;
    if (entry.kind === 'refreshToken') {
      const owner = await adapter.getDoc(`users/${entry.identity.userId}`);
      owned = Boolean(
        existing &&
          owner?._e2e?.runId === manifest.runId &&
          owner?._e2e?.project === manifest.project,
      );
    } else {
      const owner = await adapter.getDoc(`orders/${entry.identity.orderId}`);
      owned = Boolean(
        existing &&
          owner?._e2e?.runId === manifest.runId &&
          owner?._e2e?.project === manifest.project &&
          existing.orderId === entry.identity.orderId &&
          existing.photoId === entry.identity.photoId,
      );
    }
    if (owned) {
      await adapter.deleteDoc(entry.path);
    }
  }
  for (const entry of [...manifest.documents].filter(({ path: documentPath }) =>
    runOwnedDocuments.has(documentPath)).reverse()) {
    const existing = await adapter.getDoc(entry.path);
    if (
      existing?._e2e?.runId === manifest.runId &&
      existing?._e2e?.project === manifest.project
    ) {
      await adapter.deleteDoc(entry.path);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFixtureCli({
    validateFixtureEnvironment,
    buildFixtureManifest,
    buildGenericPreviewFixtureManifest,
    seedFixture,
    verifyFixture,
    cleanupFixture,
  }).catch((error) => {
    console.error(`회차 E2E fixture 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
