/**
 * 특정 store 완전 초기화 + 리팩토링 이후 스키마로 재시드 (세션83)
 *
 * 배경: 난플렉스(80189070)의 더미 주문/상품은 리팩토링 이전 스키마라 일부 필드
 *   (requestedDeliveryDate, deliveryAddress 객체, orderNumber 등)가 없어 새 화면 동선에서
 *   제대로 렌더되지 않는다. M-PATH 육안 검증을 위해 깨끗이 비우고 현행 스키마로 새로 심는다.
 *
 * 삭제 대상: orders · settlements · products (storeId 일치분). dailyCaps는 보존(소비자 e2e 베이스라인).
 * 재시드: 리팩토링 이후 스키마(seed-e2e-orders.mjs 구조 준용)로
 *   - 상품: 일반 1 · 공구 1
 *   - 주문: 일반(오늘+2일 배송) · 공구(groupDeliveryDate 조인) · 택배(PREPARING) · 완료(DELIVERED) · 취소(CANCELLED)
 *     + 날짜 칩 검증용 일반 주문 3건(오늘 / +5일 이번주밖·이번달안... 월경계 보정) 분산
 *   - 정산: pending/confirmed/paid/cancelled 4상태(라벨·색·정렬·지급버튼 육안용)
 *
 * 안전: 기본 dry-run(목록만 출력). 실제 삭제·시드는 --apply 필요.
 * 실행:
 *   node scripts/reset-store-data.mjs <storeId>          # dry-run
 *   node scripts/reset-store-data.mjs <storeId> --apply  # 실제 삭제 + 재시드
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
function resolveCredential() {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    const raw = envJson.trim();
    return cert(JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw));
  }
  const require = createRequire(import.meta.url);
  return cert(require(join(__dirname, '../apps/api/firebase-adminsdk.json')));
}
initializeApp({ credential: resolveCredential() });
const db = getFirestore();

const storeId = process.argv[2];
const apply = process.argv.includes('--apply');
if (!storeId) {
  console.error('사용법: node scripts/reset-store-data.mjs <storeId> [--apply]');
  process.exit(1);
}

function dateStr(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function collectTargets() {
  const cols = ['orders', 'settlements', 'products'];
  const targets = {};
  for (const c of cols) {
    const snap = await db.collection(c).where('storeId', '==', storeId).get();
    targets[c] = snap.docs;
  }
  return targets;
}

async function deleteTargets(targets) {
  for (const [col, docs] of Object.entries(targets)) {
    for (const d of docs) {
      // groupProductConfig는 product 삭제 시 함께 정리
      if (col === 'products') {
        await db.doc(`groupProductConfig/${d.id}`).delete().catch(() => {});
      }
      await d.ref.delete();
    }
    console.log(`  🗑  ${col}: ${docs.length}건 삭제`);
  }
}

async function reseed() {
  const now = Timestamp.now();
  const NP = 'reset-normal-product-001';
  const GP = 'reset-group-product-001';

  // ── 상품 2종 ──
  await db.doc(`products/${NP}`).set({
    id: NP, storeId, name: '리셋 일반 상품', description: 'M-PATH 육안 검증용 일반 상품',
    images: [], price: 10000, category: 'cut_flower', colors: ['레드'],
    saleType: 'normal', deliverySize: 'small', isActive: true, createdAt: now, updatedAt: now,
  });
  await db.doc(`products/${GP}`).set({
    id: GP, storeId, name: '리셋 공구 상품', description: 'M-PATH 육안 검증용 공동구매 상품',
    images: [], price: 15000, category: 'cut_flower', colors: ['핑크'],
    saleType: 'group', deliverySize: 'small', isActive: true, createdAt: now, updatedAt: now,
  });

  // 비활성 상품 1종(상품 현황 "비활성 N" 육안용)
  await db.doc(`products/reset-inactive-product-001`).set({
    id: 'reset-inactive-product-001', storeId, name: '리셋 비활성 상품', description: '비활성 표시 검증용',
    images: [], price: 8000, category: 'cut_flower', colors: ['옐로'],
    saleType: 'normal', deliverySize: 'small', isActive: false, createdAt: now, updatedAt: now,
  });
  console.log('  ✅ products: 일반·공구·비활성 3종');

  // ── 공구 설정 ──
  const groupDelivery = new Date(); groupDelivery.setDate(groupDelivery.getDate() + 7);
  const recruitDeadline = new Date(); recruitDeadline.setDate(recruitDeadline.getDate() + 3);
  await db.doc(`groupProductConfig/${GP}`).set({
    productId: GP, minQuantity: 5, targetQuantity: 20, maxPerPerson: 3, currentQuantity: 1,
    recruitDeadline: Timestamp.fromDate(recruitDeadline),
    groupDeliveryDate: Timestamp.fromDate(groupDelivery),
    createdAt: now, updatedAt: now,
  });
  console.log(`  ✅ groupProductConfig (groupDeliveryDate=${groupDelivery.toISOString().slice(0,10)})`);

  // ── 주문 공통 필드 빌더 ──
  const baseOrder = (id, over) => ({
    id, orderNumber: `RESET-${id}`, storeId, userId: 'reset-consumer',
    productId: NP, productName: '리셋 일반 상품', buyerName: '검증 소비자',
    address: '서울 검증로 1', buyerPhone: '010-0000-0001', sellerPhone: '010-0000-0000',
    hubName: null, hubAddress: null, quantity: 1, saleType: 'normal', status: 'ACCEPTED',
    deliveryMethod: 'direct', deliveryFee: 3000,
    deliveryAddress: { address: '서울 검증로 1', addressDetail: '101호', zipCode: '12345' },
    isMetropolitan: true, hubId: null, pickupCode: null, totalAmount: 13000,
    requestedDeliveryDate: dateStr(2), preparedAt: null, cancelReason: null, groupBuyConsent: null,
    createdAt: now, updatedAt: now, ...over,
  });

  // 날짜 칩 검증용 — 오늘 / +3일(이번주안) / 이번달밖. (오늘=가변, 월경계는 실행일 기준)
  await db.doc('orders/reset-order-today').set(baseOrder('reset-order-today', {
    productName: '오늘 배송 주문', requestedDeliveryDate: dateStr(0), totalAmount: 11000,
  }));
  await db.doc('orders/reset-order-thisweek').set(baseOrder('reset-order-thisweek', {
    productName: '이번주 배송 주문', requestedDeliveryDate: dateStr(3), totalAmount: 12000,
  }));
  await db.doc('orders/reset-order-faraway').set(baseOrder('reset-order-faraway', {
    productName: '먼 미래 주문', requestedDeliveryDate: dateStr(40), totalAmount: 19000,
  }));

  // 택배 주문(PREPARING) — 대기 중 그룹
  await db.doc('orders/reset-order-parcel').set(baseOrder('reset-order-parcel', {
    productName: '택배 주문', status: 'PREPARING', deliveryMethod: 'parcel', deliveryFee: 4000,
    isMetropolitan: false, totalAmount: 14000, preparedAt: now,
    deliveryAddress: { address: '부산 검증로 9', addressDetail: '202호', zipCode: '46000' },
  }));

  // 완료(DELIVERED) · 취소(CANCELLED) — 상태 뱃지 색 육안용
  await db.doc('orders/reset-order-done').set(baseOrder('reset-order-done', {
    productName: '완료 주문', status: 'DELIVERED', totalAmount: 15000, requestedDeliveryDate: dateStr(-3),
  }));
  await db.doc('orders/reset-order-cancelled').set(baseOrder('reset-order-cancelled', {
    productName: '취소 주문', status: 'CANCELLED', totalAmount: 16000, cancelReason: '검증용 취소',
    requestedDeliveryDate: dateStr(-2),
  }));

  // 공구 주문(ACCEPTED, groupDeliveryDate 조인)
  await db.doc('orders/reset-order-group').set(baseOrder('reset-order-group', {
    productId: GP, productName: '리셋 공구 상품', saleType: 'group',
    requestedDeliveryDate: null, totalAmount: 18000,
    groupBuyConsent: { agreed: true, agreedAt: now, userId: 'reset-consumer' },
  }));
  console.log('  ✅ orders: 오늘·이번주·먼미래·택배·완료·취소·공구 7건');

  // ── 정산 4상태 ──
  const SEEDS = [
    { status: 'pending', daysAgo: 0, total: 50000 },
    { status: 'confirmed', daysAgo: 1, total: 40000 },
    { status: 'paid', daysAgo: 2, total: 30000 },
    { status: 'cancelled', daysAgo: 3, total: 20000 },
  ];
  for (const { status, daysAgo, total } of SEEDS) {
    const id = `reset-settle-${status}`;
    const settledAt = Timestamp.fromDate(new Date(Date.now() - daysAgo * 86400000));
    const fee = Math.round(total * 0.05);
    await db.doc(`settlements/${id}`).set({
      id, orderId: id, storeId, totalAmount: total, platformFeeRate: 0.05,
      platformFee: fee, netAmount: total - fee, status, completedStatus: 'REVIEWED',
      settledAt, confirmedAt: ['confirmed', 'paid'].includes(status) ? now : null,
      paidAt: status === 'paid' ? now : null, createdAt: now, updatedAt: now,
    });
  }
  console.log('  ✅ settlements: pending·confirmed·paid·cancelled 4상태');
}

async function main() {
  console.log(`=== store 완전 초기화 + 재시드 ${apply ? '(--apply 실행)' : '(DRY-RUN)'} ===`);
  console.log(`storeId = ${storeId}\n`);

  const targets = await collectTargets();
  console.log('[삭제 예정]');
  for (const [col, docs] of Object.entries(targets)) {
    console.log(`  ${col}: ${docs.length}건`);
  }
  console.log('  (dailyCaps는 보존)\n');

  if (!apply) {
    console.log('⚠️  DRY-RUN — 실제로 아무것도 삭제/시드하지 않았습니다.');
    console.log('   실행하려면: node scripts/reset-store-data.mjs ' + storeId + ' --apply');
    return;
  }

  console.log('[삭제 실행]');
  await deleteTargets(targets);
  console.log('\n[재시드]');
  await reseed();
  console.log('\n✅ 완료. 셀러 화면 새로고침(F5) 후 M2부터 재검증하세요.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('오류:', e); process.exit(1); });
