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

// ─── 컨텍스트 ─────────────────────────────────────────────────────────────
const CONSUMER_STORE_ID = '80189070-6a73-4bd1-901e-1b1b5af4d5e2'; // 난플렉스 (실제 활성 상품 보유)
const SELLER_STORE_ID = '9b2cb652-ff77-46b9-a773-e1efa78fb763'; // 테스트 꽃농장 (seller@test.com)
const SELLER_USER_ID = '424b9334-cc05-41b0-a451-840e88733446';
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
  console.log(`  ✅ groupProductConfig/${GROUP_PRODUCT_ID} groupDeliveryDate=${toDateStr(groupDeliveryDate)}`);

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
  console.log(`  ✅ orders/${NORMAL_ORDER_ID} (saleType=normal, status=ACCEPTED, deliveryDate=${dateStr})`);

  // 2-5) 공구 주문 (status ACCEPTED → ACTION_REQUIRED 그룹, groupDeliveryDate 조인 검증)
  const GROUP_ORDER_ID = 'e2e-group-order-001';
  await db.doc(`orders/${GROUP_ORDER_ID}`).set({
    id: GROUP_ORDER_ID,
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
  console.log(`  ✅ orders/${GROUP_ORDER_ID} (saleType=group, groupDeliveryDate=${toDateStr(groupDeliveryDate)})`);
}

async function main() {
  console.log('🌱 E2E 시드 시작...');
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
