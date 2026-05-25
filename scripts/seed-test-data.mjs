/**
 * E2E 테스트용 Firestore 시드 스크립트
 * 실행: node scripts/seed-test-data.mjs
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const serviceAccount = require(join(__dirname, '../apps/api/firebase-adminsdk.json'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const now = Timestamp.now();

// ── 1. 판매자 계정 ──
const SELLER_ID = 'test-seller-001';
const STORE_ID  = 'test-store-001';

// ── 2. 소비자 계정 (이미 Vercel에서 가입했다면 해당 userId 사용)
const CONSUMER_ID = 'test-consumer-001';

// ── 3. 어드민 계정 (e2e 어드민 스모크 전용) ──
//  순수 어드민: storeId 없음(겸직 아님). role='admin'이라 /admin/* 접근 가능.
//  passwordHash는 placeholder — 실제 로그인 비번은 reset-user-password.mjs로 별도 설정.
const ADMIN_ID = 'test-admin-001';

async function seed() {
  console.log('🌱 Firestore 시드 시작...\n');

  // stores
  await db.doc(`stores/${STORE_ID}`).set({
    id: STORE_ID,
    name: '테스트 꽃 농장',
    ownerId: SELLER_ID,
    address: '경기도 고양시 덕양구 테스트로 1',
    phone: '031-000-0000',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`✅ stores/${STORE_ID}`);

  // deliveryFeeConfig
  await db.doc(`deliveryFeeConfig/${STORE_ID}`).set({
    storeId: STORE_ID,
    directFee: 3000,
    hubFee: 1000,
    parcelFee: 4000,
    freeThresholdDirect: 50000,
    freeThresholdHub: 30000,
    freeThresholdParcel: 50000,
    weatherRestrictionActive: false,
    updatedAt: now,
  });
  console.log(`✅ deliveryFeeConfig/${STORE_ID}`);

  // product (일반 판매)
  const PRODUCT_ID = 'test-product-001';
  await db.doc(`products/${PRODUCT_ID}`).set({
    id: PRODUCT_ID,
    storeId: STORE_ID,
    name: '테스트 장미 (E2E 전용)',
    description: '결제 E2E 테스트용 상품입니다.',
    images: [],
    price: 100,           // ← 100원 (테스트 최소 금액)
    category: 'cut_flower',
    colors: ['레드'],
    saleType: 'direct',
    deliverySize: 'small',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`✅ products/${PRODUCT_ID}`);

  // seller user
  await db.doc(`users/${SELLER_ID}`).set({
    id: SELLER_ID,
    email: 'seller@test.com',
    name: '테스트 판매자',
    phone: '010-0000-0000',
    role: 'seller',
    storeId: STORE_ID,
    providers: ['email'],
    passwordHash: '$2b$12$dummy',   // 로그인 불필요 — 참조용
    savedAddresses: [],
    fcmToken: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`✅ users/${SELLER_ID}`);

  // admin user (e2e 어드민 스모크 전용) — storeId 없음 = 순수 어드민
  await db.doc(`users/${ADMIN_ID}`).set({
    id: ADMIN_ID,
    email: 'e2e-admin@test.com',
    name: '테스트 어드민',
    phone: '010-0000-0001',
    role: 'admin',
    providers: ['email'],
    passwordHash: '$2b$12$dummy',   // placeholder — reset-user-password.mjs로 실비번 설정
    savedAddresses: [],
    fcmToken: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`✅ users/${ADMIN_ID} (role=admin)`);

  console.log('\n🎉 시드 완료!');
  console.log(`\n📋 테스트에 필요한 값:`);
  console.log(`  storeId  : ${STORE_ID}`);
  console.log(`  productId: ${PRODUCT_ID}`);
  console.log(`  price    : 100원`);
  console.log(`  admin    : e2e-admin@test.com (role=admin, 비번은 reset-user-password.mjs로 설정)`);
  console.log(`\n💡 consumer 앱에서 회원가입 후 주문 테스트 진행하세요.`);
  console.log(`💡 어드민 e2e 전:  node scripts/reset-user-password.mjs e2e-admin@test.com <비번>`);
}

seed().catch(console.error).finally(() => process.exit());
