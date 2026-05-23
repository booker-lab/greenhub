/**
 * 특정 store 주문/상품의 화면 매칭 단서(productName 등) 확인 (세션83)
 * 실행: node scripts/peek-store.mjs <storeId>
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

const storeId = process.argv[2];
if (!storeId) { console.error('사용법: node scripts/peek-store.mjs <storeId>'); process.exit(1); }

async function main() {
  const orders = await db.collection('orders').where('storeId', '==', storeId).get();
  console.log(`=== ${storeId} 주문 ${orders.size}건 (최근 8건 productName·금액·상태) ===`);
  orders.docs.slice(0, 8).forEach((d) => {
    const x = d.data();
    console.log(`  - ${x.productName ?? '(상품명없음)'} · ${x.totalAmount ?? '?'}원 · ${x.status} · ${x.deliveryMethod ?? ''}`);
  });
  const settlements = await db.collection('settlements').where('storeId', '==', storeId).get();
  console.log(`\n=== ${storeId} 정산 ${settlements.size}건 ===`);
  const byStatus = {};
  settlements.docs.forEach((d) => { const s = d.data().status; byStatus[s] = (byStatus[s] ?? 0) + 1; });
  console.log('  상태별:', JSON.stringify(byStatus));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
