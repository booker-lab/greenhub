/**
 * 화면에 보이는 주문번호로 storeId 역추적 (세션83 — 콘솔 없이 store 특정)
 *
 * 셀러 화면이 주문번호 앞 8자리(대문자)를 보여주므로, orders 컬렉션에서
 * 문서 ID가 해당 prefix로 시작하는 주문을 찾아 storeId를 출력한다.
 *
 * 실행: node scripts/find-store-by-order.mjs 0E49E4E0 406A3540
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

const prefixes = process.argv.slice(2).map((s) => s.toLowerCase());
if (prefixes.length === 0) {
  console.error('사용법: node scripts/find-store-by-order.mjs <주문번호prefix...>');
  process.exit(1);
}

async function main() {
  console.log(`=== 주문번호 prefix로 storeId 역추적 ===`);
  console.log(`찾는 prefix: ${prefixes.join(', ')}\n`);

  // orders 전체를 훑어 문서ID(소문자)가 prefix로 시작하는 것을 찾는다.
  // (prefix가 문서ID 앞부분이라 범위 쿼리 대신 전수 스캔 — 운영 규모상 충분)
  const snap = await db.collection('orders').get();
  const found = new Map(); // storeId -> count

  for (const doc of snap.docs) {
    const id = doc.id.toLowerCase();
    if (prefixes.some((p) => id.startsWith(p))) {
      const x = doc.data();
      console.log(`  ✅ 주문 ${doc.id}`);
      console.log(`     storeId    = ${x.storeId}`);
      console.log(`     storeName  = ${x.storeName ?? '(없음)'}`);
      console.log(`     status     = ${x.status} · 금액 = ${x.totalAmount ?? x.totalPrice ?? '?'}`);
      console.log('');
      found.set(x.storeId, (found.get(x.storeId) ?? 0) + 1);
    }
  }

  if (found.size === 0) {
    console.log('  ❌ 해당 prefix의 주문을 찾지 못했습니다. 전체 주문 수:', snap.size);
    return;
  }

  console.log('=== 추정 storeId ===');
  for (const [sid, n] of found) {
    console.log(`  ${sid}  (매칭 주문 ${n}건)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('조회 오류:', e);
    process.exit(1);
  });
