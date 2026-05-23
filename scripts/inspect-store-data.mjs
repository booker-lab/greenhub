/**
 * 특정 store의 데이터 현황 조회 (삭제 전 확인용 — 세션83)
 *
 * M-PATH 육안 검증을 위해 실사용 더미 store를 비우기 전에, 무엇이 얼마나 들어있는지
 * 먼저 보여준다(읽기 전용 — 아무것도 삭제/수정하지 않음).
 *
 * 대상 컬렉션(모두 storeId 필드로 묶임):
 *   products · orders · settlements · dailyCaps · groupProductConfig(products 경유)
 *
 * 실행: node scripts/inspect-store-data.mjs <storeId>
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveCredential() {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    const raw = envJson.trim();
    const json = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return cert(JSON.parse(json));
  }
  const require = createRequire(import.meta.url);
  return cert(require(join(__dirname, '../apps/api/firebase-adminsdk.json')));
}

initializeApp({ credential: resolveCredential() });
const db = getFirestore();

const storeId = process.argv[2];
if (!storeId) {
  console.error('사용법: node scripts/inspect-store-data.mjs <storeId>');
  process.exit(1);
}

async function countByStore(collection) {
  const snap = await db.collection(collection).where('storeId', '==', storeId).get();
  return snap.docs;
}

async function main() {
  console.log(`=== store 데이터 현황 (읽기 전용) ===`);
  console.log(`storeId = ${storeId}\n`);

  const products = await countByStore('products');
  const orders = await countByStore('orders');
  const settlements = await countByStore('settlements');
  const dailyCaps = await countByStore('dailyCaps');

  // groupProductConfig는 storeId가 없고 productId로 묶임 → 위 products에서 파생
  const productIds = products.map((d) => d.id);
  let groupConfigCount = 0;
  for (const pid of productIds) {
    const gc = await db.doc(`groupProductConfig/${pid}`).get();
    if (gc.exists) groupConfigCount++;
  }

  console.log(`📦 products          : ${products.length}건`);
  products.slice(0, 10).forEach((d) => {
    const x = d.data();
    console.log(`   - ${d.id} · ${x.name ?? '(이름없음)'} · saleType=${x.saleType} · active=${x.isActive}`);
  });
  if (products.length > 10) console.log(`   … 외 ${products.length - 10}건`);

  console.log(`\n🧾 orders            : ${orders.length}건`);
  const byStatus = {};
  orders.forEach((d) => {
    const s = d.data().status ?? '(없음)';
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  });
  Object.entries(byStatus).forEach(([s, n]) => console.log(`   - ${s}: ${n}건`));

  console.log(`\n💰 settlements       : ${settlements.length}건`);
  const setByStatus = {};
  settlements.forEach((d) => {
    const s = d.data().status ?? '(없음)';
    setByStatus[s] = (setByStatus[s] ?? 0) + 1;
  });
  Object.entries(setByStatus).forEach(([s, n]) => console.log(`   - ${s}: ${n}건`));

  console.log(`\n📅 dailyCaps         : ${dailyCaps.length}건`);
  console.log(`🤝 groupProductConfig: ${groupConfigCount}건 (위 products 중)`);

  const total = products.length + orders.length + settlements.length + dailyCaps.length + groupConfigCount;
  console.log(`\n합계 ${total}건 — 삭제 시 이 문서들이 제거됩니다.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('조회 오류:', e);
    process.exit(1);
  });
