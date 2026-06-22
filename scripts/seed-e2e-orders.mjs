/**
 * e2e 회귀 가드용 시드 — 세션51 T6
 *
 * 1) 소비자 일반 주문 흐름: 80189070(난플렉스) 스토어에 향후 14일치 dailyCaps 시드.
 *    → DeliveryDatePicker가 활성 일자를 노출하는지 검증할 수 있는 베이스라인.
 *
 * 2) 셀러 주문 탭 / 공구 조인: 9b2cb652(테스트 꽃농장) 스토어에 일반·공구 상품 +
 *    groupProductConfig + 일반/공구 주문을 admin SDK로 직접 시드.
 *    → SaleTypeToggle 전환 + groupDeliveryDate 헤더 가드 검증용.
 *
 * 멱등성: ID가 'e2e-' prefix로 고정되어 재실행 시 set으로 덮어쓴다.
 * 정리: scripts/cleanup-spec-residue.mjs는 'e2e-' 시드를 보존한다(별도 정책).
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 인증 자격 해석 — cleanup-spec-residue.mjs:24-46 과 동일 규약(검증된 패턴 이식, #CL-42).
 *  1. FIREBASE_SERVICE_ACCOUNT_JSON env (CI 러너 — 서비스 계정 키 JSON 문자열)
 *  2. apps/api/firebase-adminsdk.json 로컬 키 (개발자 머신 폴백, gitignore 대상)
 */
function resolveCredential() {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    try {
      // BOM(U+FEFF)/주변 공백 제거 — Windows gh CLI 파이프 업로드 시 BOM 혼입 방어
      const raw = envJson.trim();
      const json = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      return cert(JSON.parse(json));
    } catch (e) {
      console.error(`[seed-e2e-orders] FIREBASE_SERVICE_ACCOUNT_JSON 파싱 실패: ${e.message}`);
      process.exit(1);
    }
  }
  try {
    const require = createRequire(import.meta.url);
    return cert(require(join(__dirname, '../apps/api/firebase-adminsdk.json')));
  } catch {
    console.error(
      '[seed-e2e-orders] no credential — set FIREBASE_SERVICE_ACCOUNT_JSON env or place apps/api/firebase-adminsdk.json',
    );
    process.exit(1);
  }
}

initializeApp({ credential: resolveCredential() });
const db = getFirestore();

// ─── 컨텍스트 ─────────────────────────────────────────────────────────────
const CONSUMER_STORE_ID = '80189070-6a73-4bd1-901e-1b1b5af4d5e2'; // 난플렉스 (실제 활성 상품 보유)
const SELLER_STORE_ID = '9b2cb652-ff77-46b9-a773-e1efa78fb763'; // 테스트 꽃농장 (seller@test.com)
const CONSUMER_USER_ID = '6822a381-6c71-4b66-9d6f-f60cd477a785';

// 'YYYY-MM-DD' 변환 (KST 기준 — Firestore date 필드 일관성)
function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

async function seedConsumerDailyCaps() {
  console.log(`\n[1] 소비자 dailyCaps 시드 (storeId=${CONSUMER_STORE_ID.slice(0, 8)})`);

  // 실 storeId 풀확인 — 활성 상품을 가진 store를 동적으로 조회 (하드코딩 안전망)
  const products = await db.collection('products').where('isActive', '==', true).limit(1).get();
  if (products.empty) {
    console.warn('  활성 상품이 없습니다. dailyCaps 시드만 진행합니다.');
  }
  const resolvedStoreId = products.empty ? CONSUMER_STORE_ID : products.docs[0].data().storeId;
  console.log(`  resolvedStoreId=${resolvedStoreId.slice(0, 8)}`);

  // 오늘부터 14일치 슬롯 — 충분한 totalCap (10) 으로 잔여 확보
  const today = new Date();
  let count = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = toDateStr(d);
    const id = `${resolvedStoreId}_${dateStr}`;
    await db.doc(`dailyCaps/${id}`).set({
      id,
      storeId: resolvedStoreId,
      date: dateStr,
      totalCap: 10,
      usedSlots: 0,
    });
    count++;
  }
  console.log(`  ✅ dailyCaps ${count}건 시드 완료 (${toDateStr(today)} ~ +13일)`);
}

async function seedSellerOrders() {
  console.log(`\n[2] 셀러 store(${SELLER_STORE_ID.slice(0, 8)}) 시드 — 상품 + 주문 + 공구설정`);

  const now = Timestamp.now();
  const today = new Date();

  // 2-1) 일반 상품 + 공구 상품 (e2e 식별자 prefix 고정 — 멱등성)
  const NORMAL_PRODUCT_ID = 'e2e-normal-product-001';
  const GROUP_PRODUCT_ID = 'e2e-group-product-001';

  await db.doc(`products/${NORMAL_PRODUCT_ID}`).set({
    id: NORMAL_PRODUCT_ID,
    storeId: SELLER_STORE_ID,
    name: 'E2E 일반 상품',
    description: 'e2e 셀러 주문 탭 검증용 일반 상품',
    images: [],
    price: 10000,
    category: 'cut_flower',
    colors: ['레드'],
    saleType: 'normal',
    deliverySize: 'small',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.doc(`products/${GROUP_PRODUCT_ID}`).set({
    id: GROUP_PRODUCT_ID,
    storeId: SELLER_STORE_ID,
    name: 'E2E 공구 상품',
    description: 'e2e 셀러 공구 탭 검증용 공동구매 상품',
    images: [],
    price: 15000,
    category: 'cut_flower',
    colors: ['핑크'],
    saleType: 'group',
    deliverySize: 'small',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  ✅ products: ${NORMAL_PRODUCT_ID}, ${GROUP_PRODUCT_ID}`);

  // 2-2) 공구 설정 + groupDeliveryDate (오늘 +7일)
  const groupDeliveryDate = new Date(today);
  groupDeliveryDate.setDate(today.getDate() + 7);
  const recruitDeadline = new Date(today);
  recruitDeadline.setDate(today.getDate() + 3);

  await db.doc(`groupProductConfig/${GROUP_PRODUCT_ID}`).set({
    productId: GROUP_PRODUCT_ID,
    minQuantity: 5,
    targetQuantity: 20,
    maxPerPerson: 3,
    currentQuantity: 1,
    recruitDeadline: Timestamp.fromDate(recruitDeadline),
    groupDeliveryDate: Timestamp.fromDate(groupDeliveryDate),
    createdAt: now,
    updatedAt: now,
  });
  console.log(
    `  ✅ groupProductConfig/${GROUP_PRODUCT_ID} groupDeliveryDate=${toDateStr(groupDeliveryDate)}`,
  );

  // 2-3) 셀러 store용 dailyCaps — 일반 주문이 'X일' 헤더에 그룹핑되도록
  const normalDeliveryDate = new Date(today);
  normalDeliveryDate.setDate(today.getDate() + 2);
  const dateStr = toDateStr(normalDeliveryDate);
  const capId = `${SELLER_STORE_ID}_${dateStr}`;
  await db.doc(`dailyCaps/${capId}`).set({
    id: capId,
    storeId: SELLER_STORE_ID,
    date: dateStr,
    totalCap: 10,
    usedSlots: 1,
  });
  console.log(`  ✅ dailyCaps/${capId}`);

  // 2-4) 일반 주문 (status ACCEPTED → ACTION_REQUIRED 그룹)
  const NORMAL_ORDER_ID = 'e2e-normal-order-001';
  await db.doc(`orders/${NORMAL_ORDER_ID}`).set({
    id: NORMAL_ORDER_ID,
    orderNumber: '20260101-000001', // UX-11: 고정 과거 일자 prefix로 실데이터 카운터 충돌 회피
    storeId: SELLER_STORE_ID,
    userId: CONSUMER_USER_ID,
    productId: NORMAL_PRODUCT_ID,
    productName: 'E2E 일반 상품',
    buyerName: 'E2E 소비자',
    address: '서울 테스트로 1',
    buyerPhone: '010-0000-0001',
    sellerPhone: '010-0000-0000',
    hubName: null,
    hubAddress: null,
    quantity: 1,
    saleType: 'normal',
    status: 'ACCEPTED',
    deliveryMethod: 'direct',
    deliveryFee: 3000,
    deliveryAddress: { address: '서울 테스트로 1', addressDetail: '101호', zipCode: '12345' },
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: 13000,
    requestedDeliveryDate: dateStr,
    preparedAt: null,
    cancelReason: null,
    groupBuyConsent: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log(
    `  ✅ orders/${NORMAL_ORDER_ID} (saleType=normal, status=ACCEPTED, deliveryDate=${dateStr})`,
  );

  // 2-5) 공구 주문 (status ACCEPTED → ACTION_REQUIRED 그룹, groupDeliveryDate 조인 검증)
  const GROUP_ORDER_ID = 'e2e-group-order-001';
  await db.doc(`orders/${GROUP_ORDER_ID}`).set({
    id: GROUP_ORDER_ID,
    orderNumber: '20260101-000002', // UX-11
    storeId: SELLER_STORE_ID,
    userId: CONSUMER_USER_ID,
    productId: GROUP_PRODUCT_ID,
    productName: 'E2E 공구 상품',
    buyerName: 'E2E 소비자',
    address: '서울 테스트로 1',
    buyerPhone: '010-0000-0001',
    sellerPhone: '010-0000-0000',
    hubName: null,
    hubAddress: null,
    quantity: 1,
    saleType: 'group',
    status: 'ACCEPTED',
    deliveryMethod: 'direct',
    deliveryFee: 3000,
    deliveryAddress: { address: '서울 테스트로 1', addressDetail: '101호', zipCode: '12345' },
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: 18000,
    requestedDeliveryDate: null,
    preparedAt: null,
    cancelReason: null,
    groupBuyConsent: {
      agreed: true,
      agreedAt: Timestamp.now(),
      userId: CONSUMER_USER_ID,
    },
    createdAt: now,
    updatedAt: now,
  });
  console.log(
    `  ✅ orders/${GROUP_ORDER_ID} (saleType=group, groupDeliveryDate=${toDateStr(groupDeliveryDate)})`,
  );

  // 2-6) 택배 주문 (deliveryMethod=parcel, status=PREPARING → 셀러 "택배 발송 완료" 동선 BUG-16 T5)
  const PARCEL_ORDER_ID = 'e2e-parcel-order-001';
  await db.doc(`orders/${PARCEL_ORDER_ID}`).set({
    id: PARCEL_ORDER_ID,
    orderNumber: '20260101-000003', // UX-11
    storeId: SELLER_STORE_ID,
    userId: CONSUMER_USER_ID,
    productId: NORMAL_PRODUCT_ID,
    productName: 'E2E 택배 상품',
    buyerName: 'E2E 소비자',
    address: '부산 테스트로 9',
    buyerPhone: '010-0000-0001',
    sellerPhone: '010-0000-0000',
    hubName: null,
    hubAddress: null,
    quantity: 1,
    saleType: 'normal',
    status: 'PREPARING',
    deliveryMethod: 'parcel',
    deliveryFee: 4000,
    deliveryAddress: { address: '부산 테스트로 9', addressDetail: '202호', zipCode: '46000' },
    isMetropolitan: false,
    hubId: null,
    pickupCode: null,
    totalAmount: 14000,
    requestedDeliveryDate: dateStr,
    preparedAt: now,
    cancelReason: null,
    groupBuyConsent: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  ✅ orders/${PARCEL_ORDER_ID} (deliveryMethod=parcel, status=PREPARING)`);

  // 2-7) 송장 표시 회귀 전용 완료 주문 — 쓰기 동선과 분리해 seller·consumer 읽기 계약을 검증
  await seedMyPageOrders(now, dateStr, NORMAL_PRODUCT_ID, GROUP_PRODUCT_ID);

  // 2-8) 모바일 모달 회귀 전용 주문 — 발송 쓰기 테스트와 상태를 공유하지 않는다.
  const PARCEL_MODAL_ORDER_ID = 'e2e-parcel-modal-order-001';
  await db.doc(`orders/${PARCEL_MODAL_ORDER_ID}`).set({
    id: PARCEL_MODAL_ORDER_ID,
    orderNumber: '20260101-000005',
    storeId: SELLER_STORE_ID,
    userId: CONSUMER_USER_ID,
    productId: NORMAL_PRODUCT_ID,
    productName: 'E2E 모바일 모달 상품',
    buyerName: 'E2E 소비자',
    address: '부산 테스트로 9',
    buyerPhone: '010-0000-0001',
    sellerPhone: '010-0000-0000',
    hubName: null,
    hubAddress: null,
    quantity: 1,
    saleType: 'normal',
    status: 'PREPARING',
    deliveryMethod: 'parcel',
    deliveryFee: 4000,
    deliveryAddress: { address: '부산 테스트로 9', addressDetail: '202호', zipCode: '46000' },
    isMetropolitan: false,
    hubId: null,
    pickupCode: null,
    totalAmount: 14000,
    requestedDeliveryDate: dateStr,
    preparedAt: now,
    cancelReason: null,
    groupBuyConsent: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  ✅ orders/${PARCEL_MODAL_ORDER_ID} (deliveryMethod=parcel, status=PREPARING)`);
}

async function seedDeliveredParcelOrder(
  now = Timestamp.now(),
  dateStr = toDateStr(new Date()),
  productId = 'e2e-normal-product-001',
) {
  const DELIVERED_PARCEL_ORDER_ID = 'e2e-parcel-delivered-order-001';
  await db.doc(`orders/${DELIVERED_PARCEL_ORDER_ID}`).set({
    id: DELIVERED_PARCEL_ORDER_ID,
    orderNumber: '20260101-000004',
    storeId: SELLER_STORE_ID,
    userId: CONSUMER_USER_ID,
    productId,
    productName: 'E2E 송장 확인 상품',
    buyerName: 'E2E 소비자',
    address: '부산 테스트로 9',
    buyerPhone: '010-0000-0001',
    sellerPhone: '010-0000-0000',
    hubName: null,
    hubAddress: null,
    quantity: 1,
    saleType: 'normal',
    status: 'DELIVERED',
    deliveryMethod: 'parcel',
    deliveryFee: 4000,
    deliveryAddress: { address: '부산 테스트로 9', addressDetail: '202호', zipCode: '46000' },
    isMetropolitan: false,
    hubId: null,
    pickupCode: null,
    totalAmount: 14000,
    requestedDeliveryDate: dateStr,
    preparedAt: now,
    courierCompany: 'CJ대한통운',
    trackingNumber: '1234567890',
    cancelReason: null,
    groupBuyConsent: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log(
    `  ✅ orders/${DELIVERED_PARCEL_ORDER_ID} (status=DELIVERED, trackingNumber=1234567890)`,
  );
}

async function seedMyPageOrders(
  now = Timestamp.now(),
  dateStr = toDateStr(new Date()),
  normalProductId = 'e2e-normal-product-001',
  groupProductId = 'e2e-group-product-001',
) {
  await seedDeliveredParcelOrder(now, dateStr, normalProductId);

  const hubOrderId = 'e2e-mypage-hub-picked-order-001';
  await db.doc(`orders/${hubOrderId}`).set({
    id: hubOrderId,
    orderNumber: '20260101-000006',
    storeId: SELLER_STORE_ID,
    userId: CONSUMER_USER_ID,
    productId: normalProductId,
    productName: 'E2E 픽업 확인 상품',
    buyerName: 'E2E 소비자',
    address: '부산 테스트로 9',
    buyerPhone: '010-0000-0001',
    sellerPhone: '010-0000-0000',
    hubName: 'E2E 테스트 거점',
    hubAddress: '부산 거점로 10',
    quantity: 1,
    saleType: 'normal',
    status: 'PICKED_UP',
    deliveryMethod: 'hub',
    deliveryFee: 0,
    deliveryAddress: null,
    isMetropolitan: false,
    hubId: 'e2e-hub-001',
    pickupCode: '482731',
    totalAmount: 10000,
    requestedDeliveryDate: dateStr,
    preparedAt: now,
    cancelReason: null,
    groupBuyConsent: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  ✅ orders/${hubOrderId} (status=PICKED_UP, pickupCode=482731)`);

  const groupOrderId = 'e2e-mypage-group-order-001';
  await db.doc(`orders/${groupOrderId}`).set({
    id: groupOrderId,
    orderNumber: '20260101-000007',
    storeId: SELLER_STORE_ID,
    userId: CONSUMER_USER_ID,
    productId: groupProductId,
    productName: 'E2E MY 공동구매 상품',
    buyerName: 'E2E 소비자',
    address: '서울 테스트로 1',
    buyerPhone: '010-0000-0001',
    sellerPhone: '010-0000-0000',
    hubName: null,
    hubAddress: null,
    quantity: 1,
    saleType: 'group',
    status: 'ACCEPTED',
    deliveryMethod: 'direct',
    deliveryFee: 3000,
    deliveryAddress: { address: '서울 테스트로 1', addressDetail: '101호', zipCode: '12345' },
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: 18000,
    requestedDeliveryDate: null,
    preparedAt: null,
    cancelReason: null,
    groupBuyConsent: { agreed: true, agreedAt: now, userId: CONSUMER_USER_ID },
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  ✅ orders/${groupOrderId} (saleType=group, status=ACCEPTED)`);
}

async function main() {
  console.log('🌱 E2E 시드 시작...');
  if (process.argv.includes('--consumer-mypage-only')) {
    await seedMyPageOrders();
    console.log('\n🎉 MY 주문 E2E 시드 완료');
    return;
  }
  await seedConsumerDailyCaps();
  await seedSellerOrders();
  console.log('\n🎉 E2E 시드 완료');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
