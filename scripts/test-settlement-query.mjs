/**
 * 정산 목록 쿼리(orderBy settledAt desc) 인덱스 동작 직접 검증 (세션83)
 * API getSettlements와 동일 쿼리를 admin SDK로 실행해 인덱스 에러 재현/해소 확인.
 * 실행: node scripts/test-settlement-query.mjs <storeId>
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
function resolveCredential() {
  const require = createRequire(import.meta.url);
  return cert(require(join(__dirname, '../apps/api/firebase-adminsdk.json')));
}
initializeApp({ credential: resolveCredential() });
const db = getFirestore();
const storeId = process.argv[2];

async function tryQuery(label, build) {
  try {
    const snap = await build().get();
    console.log(`  ✅ ${label} — ${snap.size}건`);
    snap.docs.forEach((d) => console.log(`     · ${d.data().status} · settledAt=${d.data().settledAt?.toDate?.().toISOString?.().slice(0,10)}`));
    return true;
  } catch (e) {
    console.log(`  ❌ ${label} — ${e.code ?? ''} ${e.message}`);
    // 인덱스 생성 URL 추출
    const m = String(e.message).match(/https:\/\/console\.firebase[^\s]+/);
    if (m) console.log(`     인덱스 생성 URL: ${m[0]}`);
    return false;
  }
}

async function main() {
  console.log(`=== 정산 목록 쿼리 인덱스 검증 (storeId=${storeId}) ===\n`);
  // 셀러 목록: where(storeId) + orderBy(settledAt desc)
  await tryQuery('storeId + settledAt DESC', () =>
    db.collection('settlements').where('storeId', '==', storeId).orderBy('settledAt', 'desc'));
  // status 필터: where(storeId) + where(status) + orderBy(settledAt desc)
  await tryQuery('storeId + status==pending + settledAt DESC', () =>
    db.collection('settlements').where('storeId', '==', storeId).where('status', '==', 'pending').orderBy('settledAt', 'desc'));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
