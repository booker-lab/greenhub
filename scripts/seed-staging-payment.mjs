/**
 * GreenHub 비운영 결제 검증용 최소 fixture.
 *
 * 실행 예:
 *   railway run -s api -e staging node scripts/seed-staging-payment.mjs --apply
 *
 * 필수 환경 변수:
 *   FIREBASE_PROJECT_ID=green-staging-74557
 *   FIREBASE_SERVICE_ACCOUNT_JSON=<staging service account JSON>
 *   STAGING_SEED_USER_PASSWORD=<8자 이상, 출력하지 않음>
 *
 * --apply 없이는 쓰지 않는다. deterministic ID와 set(merge)만 사용하므로 반복 실행 가능하다.
 */
import bcrypt from 'bcrypt';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const TARGET_PROJECT_ID = 'green-staging-74557';
const APPLY = process.argv.includes('--apply');

export const FIXTURE_IDS = Object.freeze({
  consumerUser: 'staging-payment-consumer',
  sellerUser: 'staging-payment-seller',
  legacyStore: 'staging-payment-store',
  legacyProduct: 'staging-payment-product',
  roundStore: 'staging-round-direct-store',
  roundProduct: 'staging-round-direct-product',
  saleRound: 'staging-round-direct-open',
  saleRoundItem: 'staging-round-direct-item',
});

function parseCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required');
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const serviceAccount = JSON.parse(normalized);
  if (serviceAccount.project_id !== TARGET_PROJECT_ID) {
    throw new Error('service account project_id does not match the staging target');
  }
  return cert(serviceAccount);
}

function assertSafety() {
  if (process.env.FIREBASE_PROJECT_ID !== TARGET_PROJECT_ID) {
    throw new Error(`FIREBASE_PROJECT_ID must be exactly ${TARGET_PROJECT_ID}`);
  }
  if (!APPLY) return;
  const password = process.env.STAGING_SEED_USER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('STAGING_SEED_USER_PASSWORD must contain at least 8 characters');
  }
}

function kstDate(daysFromToday) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() + daysFromToday);
  return now.toISOString().slice(0, 10);
}

function isoFromNow(days, hour = 0) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000).toISOString();
}

async function seed() {
  assertSafety();
  console.log(
    `[seed-staging-payment] target=${TARGET_PROJECT_ID} mode=${APPLY ? 'apply' : 'dry-run'}`,
  );
  console.log(`[seed-staging-payment] fixtureIds=${JSON.stringify(FIXTURE_IDS)}`);
  if (!APPLY) {
    console.log('[seed-staging-payment] no writes; pass --apply after reviewing the target');
    return;
  }

  const credential = parseCredential();
  const app = getApps()[0] ?? initializeApp({ credential, projectId: TARGET_PROJECT_ID });
  const db = getFirestore(app);
  const now = Timestamp.now();
  const passwordHash = await bcrypt.hash(process.env.STAGING_SEED_USER_PASSWORD, 12);

  const consumer = {
    id: FIXTURE_IDS.consumerUser,
    email: process.env.STAGING_SEED_USER_EMAIL ?? 'greenhub.staging.payment@example.com',
    name: 'GreenHub Staging 결제 사용자',
    phone: '010-0000-0000',
    role: 'consumer',
    storeId: null,
    providers: ['email'],
    passwordHash,
    savedAddresses: [
      {
        id: 'staging-address',
        label: 'staging 배송지',
        address: '경기도 이천시 부발읍 테스트로 1',
        addressDetail: '테스트 전용',
        zipCode: '17300',
        isDefault: true,
      },
    ],
    fcmToken: null,
    createdAt: now,
    updatedAt: now,
  };

  const seller = {
    id: FIXTURE_IDS.sellerUser,
    email: 'greenhub.staging.seller@example.com',
    name: 'GreenHub Staging 판매자',
    phone: null,
    role: 'seller',
    storeId: FIXTURE_IDS.legacyStore,
    providers: ['email'],
    passwordHash,
    savedAddresses: [],
    fcmToken: null,
    createdAt: now,
    updatedAt: now,
  };

  const storeBase = {
    ownerId: FIXTURE_IDS.sellerUser,
    ceoName: 'Staging',
    phone: '031-000-0000',
    address: '경기도 이천시 부발읍 테스트로 1',
    businessNumber: null,
    logoUrl: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const productBase = {
    images: [],
    price: 100,
    category: 'cut_flower',
    saleType: 'normal',
    deliverySize: 'small',
    colors: [],
    createdAt: now,
    updatedAt: now,
  };

  const batch = db.batch();
  const set = (path, data) => batch.set(db.doc(path), data, { merge: true });
  set(`users/${FIXTURE_IDS.consumerUser}`, consumer);
  set(`users/${FIXTURE_IDS.sellerUser}`, seller);
  set(`stores/${FIXTURE_IDS.legacyStore}`, {
    ...storeBase,
    id: FIXTURE_IDS.legacyStore,
    name: 'GreenHub Staging 결제 스토어',
    salesMode: 'legacy',
  });
  set(`stores/${FIXTURE_IDS.roundStore}`, {
    ...storeBase,
    id: FIXTURE_IDS.roundStore,
    name: 'GreenHub Staging 회차 직배송',
    salesMode: 'round_direct',
  });
  set(`products/${FIXTURE_IDS.legacyProduct}`, {
    ...productBase,
    id: FIXTURE_IDS.legacyProduct,
    storeId: FIXTURE_IDS.legacyStore,
    name: 'Staging 결제 테스트 상품 100원',
    description: 'PortOne 테스트 결제 전용 최소 상품',
    isActive: true,
  });
  set(`products/${FIXTURE_IDS.roundProduct}`, {
    ...productBase,
    id: FIXTURE_IDS.roundProduct,
    storeId: FIXTURE_IDS.roundStore,
    name: 'Staging 회차 결제 테스트 상품 100원',
    description: 'Task 2.10 회차 결제 복구 검증 전용',
    isActive: false,
  });

  for (const storeId of [FIXTURE_IDS.legacyStore, FIXTURE_IDS.roundStore]) {
    set(`deliveryFeeConfig/${storeId}`, {
      storeId,
      directFee: 0,
      hubFee: 0,
      parcelFee: 0,
      freeThresholdDirect: 0,
      freeThresholdHub: 0,
      freeThresholdParcel: 0,
      weatherRestrictionActive: false,
      updatedAt: now,
    });
  }

  for (let day = 0; day < 14; day += 1) {
    const date = kstDate(day);
    const id = `${FIXTURE_IDS.legacyStore}_${date}`;
    set(`dailyCaps/${id}`, {
      id,
      storeId: FIXTURE_IDS.legacyStore,
      date,
      totalCap: 10,
      usedSlots: 0,
      updatedAt: now,
    });
  }

  set(`saleRounds/${FIXTURE_IDS.saleRound}`, {
    id: FIXTURE_IDS.saleRound,
    storeId: FIXTURE_IDS.roundStore,
    name: 'Staging Task 2.10 열린 회차',
    status: 'OPEN',
    schedule: {
      orderOpenAt: isoFromNow(-1),
      orderCloseAt: isoFromNow(7),
      auctionAt: isoFromNow(7, 1),
      deliveryStartAt: isoFromNow(8),
      deliveryEndAt: isoFromNow(9),
      timezone: 'Asia/Seoul',
    },
    deliveryRegion: {
      id: 'icheon',
      label: '이천시',
      province: '경기도',
      city: '이천시',
      enabled: true,
    },
    limits: { maxDeliveryAddresses: 10, maxItemQuantity: 10 },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
    carrotLandingUrl: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  set(`saleRoundItems/${FIXTURE_IDS.saleRoundItem}`, {
    id: FIXTURE_IDS.saleRoundItem,
    roundId: FIXTURE_IDS.saleRound,
    storeId: FIXTURE_IDS.roundStore,
    productId: FIXTURE_IDS.roundProduct,
    productNameSnapshot: 'Staging 회차 결제 테스트 상품 100원',
    productImageUrlSnapshot: null,
    roundPrice: 100,
    saleLimitQuantity: 10,
    reservedQuantity: 0,
    orderedQuantity: 0,
    displayOrder: 1,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });
  set('testFixtures/staging-payment', {
    id: 'staging-payment',
    projectId: TARGET_PROJECT_ID,
    fixtureIds: FIXTURE_IDS,
    updatedAt: now,
  });

  await batch.commit();
  console.log('[seed-staging-payment] completed');
}

seed().catch((error) => {
  console.error(`[seed-staging-payment] failed: ${error.message}`);
  process.exitCode = 1;
});
