/**
 * M1 #230 준비 물량 집계표 육안용 — 미발송 일반 주문 일부의 배송예정일을 오늘로 임시 설정 (세션83)
 *
 * 준비 물량 표(상품별 집계 + "N개 상품·총 N개")를 화면에서 보려면, prep 집계 조건
 * (saleType!='group' && status in [ACCEPTED,CONFIRMED,PREPARING] && requestedDeliveryDate==오늘)
 * 을 만족하는 주문이 있어야 한다. 기존 미발송 일반 주문 중 앞 N건의 requestedDeliveryDate를
 * 오늘로 바꾼다.
 *
 * 안전장치:
 *   - 원래 값을 settlements 무관 별도 백업 문서(prep-backup/<orderId>)에 저장 → --restore로 복원.
 *   - 운영 주문 필드를 임시 수정하므로, 검증 종료 후 반드시 --restore 실행.
 *
 * 실행:
 *   node scripts/seed-prep-today.mjs <storeId> [건수=3]   # 오늘로 설정 + 원본 백업
 *   node scripts/seed-prep-today.mjs <storeId> --restore  # 백업에서 원본 복원
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
const isRestore = process.argv.includes('--restore');
const countArg = process.argv[3] && !process.argv[3].startsWith('--') ? parseInt(process.argv[3], 10) : 3;
const UNSHIPPED = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];
const BACKUP = 'prep-backup'; // 복원용 백업 컬렉션

if (!storeId) {
  console.error('사용법: node scripts/seed-prep-today.mjs <storeId> [건수] | --restore');
  process.exit(1);
}

async function restore() {
  console.log('=== 준비 물량 임시 시드 복원 (--restore) ===\n');
  const backups = await db.collection(BACKUP).get();
  if (backups.empty) {
    console.log('복원할 백업이 없습니다.');
    return;
  }
  for (const b of backups.docs) {
    const { orderId, requestedDeliveryDate } = b.data();
    // 원래 값이 null/없음이면 필드 삭제, 아니면 원복
    const FieldValue = (await import('firebase-admin/firestore')).FieldValue;
    await db.doc(`orders/${orderId}`).update({
      requestedDeliveryDate: requestedDeliveryDate ?? FieldValue.delete(),
    });
    await b.ref.delete();
    console.log(`  ♻  ${orderId} → requestedDeliveryDate=${requestedDeliveryDate ?? '(삭제·원래없음)'}`);
  }
  console.log('\n✅ 복원 완료. 준비 물량 화면은 다시 EmptyState로 돌아갑니다.');
}

async function seed() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== 준비 물량 집계표 육안용 시드 (오늘=${today}) ===\n`);

  const snap = await db.collection('orders').where('storeId', '==', storeId).get();
  const targets = snap.docs
    .filter((d) => {
      const x = d.data();
      return x.saleType !== 'group' && UNSHIPPED.includes(x.status);
    })
    .slice(0, countArg);

  if (targets.length === 0) {
    console.log('미발송 일반 주문이 없습니다.');
    return;
  }

  for (const d of targets) {
    const x = d.data();
    // 원본 백업(이미 있으면 덮지 않음 — 중복 실행 방어)
    const bref = db.doc(`${BACKUP}/${d.id}`);
    const bexist = await bref.get();
    if (!bexist.exists) {
      await bref.set({ orderId: d.id, requestedDeliveryDate: x.requestedDeliveryDate ?? null });
    }
    await d.ref.update({ requestedDeliveryDate: `${today}T00:00:00.000Z` });
    console.log(`  ✅ ${d.id} · ${x.productName ?? '(상품명없음)'} · ${x.status} · 수량 ${x.quantity ?? '?'} → 배송예정 오늘`);
  }

  console.log(`\n✅ ${targets.length}건을 오늘 배송예정으로 설정. [준비] 탭에서 '오늘 준비 물량' 집계표 확인.`);
  console.log('   검증 종료 후 복원: node scripts/seed-prep-today.mjs ' + storeId + ' --restore');
}

(isRestore ? restore() : seed())
  .then(() => process.exit(0))
  .catch((e) => { console.error('오류:', e); process.exit(1); });
