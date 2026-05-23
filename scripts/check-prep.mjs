/**
 * 준비 물량(prep) 집계 대상 주문이 있는지 진단 (세션83)
 * 기준(apps/seller/src/lib/prep.ts): saleType!='group' && status in [ACCEPTED,CONFIRMED,PREPARING]
 *   && requestedDeliveryDate <= 오늘
 * 실행: node scripts/check-prep.mjs <storeId>
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
const UNSHIPPED = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const snap = await db.collection('orders').where('storeId', '==', storeId).get();
  console.log(`storeId=${storeId} · 오늘=${today} · 전체주문 ${snap.size}건\n`);

  let unshipped = 0, todayPrep = 0, delayed = 0, future = 0, noDate = 0, group = 0;
  for (const d of snap.docs) {
    const x = d.data();
    if (x.saleType === 'group') { group++; continue; }
    if (!UNSHIPPED.includes(x.status)) continue;
    unshipped++;
    const rdd = x.requestedDeliveryDate ? String(x.requestedDeliveryDate).slice(0, 10) : null;
    if (rdd === null) { noDate++; }
    else if (rdd === today) { todayPrep++; }
    else if (rdd < today) { delayed++; console.log(`  [지연] ${x.productName} · 배송예정 ${rdd} · ${x.status}`); }
    else { future++; }
  }
  console.log(`\n미발송(일반) ${unshipped}건 중:`);
  console.log(`  오늘 준비 대상 : ${todayPrep}건  ← 'today' 섹션`);
  console.log(`  지연(과거)     : ${delayed}건  ← 'delayed' 섹션`);
  console.log(`  미래 배송일    : ${future}건  (제외)`);
  console.log(`  배송일 없음    : ${noDate}건  (제외)`);
  console.log(`  공구 주문      : ${group}건  (제외)`);
  console.log(`\n→ ${todayPrep + delayed === 0 ? 'EmptyState 정상(준비 대상 0건)' : '준비 물량 표가 떠야 함'}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
