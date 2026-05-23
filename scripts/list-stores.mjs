/**
 * orders·products를 store별로 집계해 어떤 store들이 있는지 한눈에 보기 (세션83)
 * 실행: node scripts/list-stores.mjs
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
    return cert(JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw));
  }
  const require = createRequire(import.meta.url);
  return cert(require(join(__dirname, '../apps/api/firebase-adminsdk.json')));
}
initializeApp({ credential: resolveCredential() });
const db = getFirestore();

function agg(docs, field = 'storeId') {
  const m = new Map();
  for (const d of docs) {
    const x = d.data();
    const k = x[field] ?? '(없음)';
    if (!m.has(k)) m.set(k, { count: 0, storeName: x.storeName ?? null, sample: d.id });
    m.get(k).count++;
  }
  return m;
}

async function main() {
  const orders = await db.collection('orders').get();
  const products = await db.collection('products').get();
  const stores = await db.collection('stores').get().catch(() => ({ docs: [] }));

  // stores 컬렉션이 있으면 id→이름 매핑
  const nameById = new Map();
  for (const s of stores.docs) nameById.set(s.id, s.data().name ?? s.data().storeName ?? '(이름없음)');

  console.log(`=== stores 컬렉션 (${stores.docs.length}개) ===`);
  for (const s of stores.docs) {
    const x = s.data();
    console.log(`  ${s.id} · ${x.name ?? x.storeName ?? '(이름없음)'} · owner=${x.ownerId ?? x.userId ?? '?'}`);
  }

  console.log(`\n=== orders store별 집계 (총 ${orders.size}건) ===`);
  for (const [sid, info] of agg(orders.docs)) {
    console.log(`  ${sid} · 주문 ${info.count}건 · 이름=${nameById.get(sid) ?? info.storeName ?? '?'}`);
  }

  console.log(`\n=== products store별 집계 (총 ${products.size}건) ===`);
  for (const [sid, info] of agg(products.docs)) {
    console.log(`  ${sid} · 상품 ${info.count}건 · 이름=${nameById.get(sid) ?? info.storeName ?? '?'}`);
  }

  // 화면 단서: "꽃차 직배송" 텍스트가 어디서 오는지 — 주문 1건 필드 덤프
  console.log(`\n=== 주문 샘플 1건 필드(화면 매칭용) ===`);
  if (orders.docs[0]) {
    const x = orders.docs[0].data();
    console.log('  keys:', Object.keys(x).join(', '));
    console.log('  id:', orders.docs[0].id, '| orderNumber:', x.orderNumber, '| storeName:', x.storeName);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
