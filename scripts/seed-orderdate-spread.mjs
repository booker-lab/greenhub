/**
 * M2 #235 날짜 칩 동작 육안용 — 미발송 일반 주문의 배송예정일을 서로 다른 날짜로 분산 (세션83)
 *
 * 날짜 칩(오늘/이번주/이번달) 전환 시 목록이 실제로 달라지는지 보려면,
 * requestedDeliveryDate가 각 범위에 분포한 주문이 있어야 한다.
 * 처리 필요(ACTION_REQUIRED) 탭은 활성 탭이라 requestedDeliveryDate를 날짜 기준으로 쓴다
 * (apps/seller/src/app/orders/_constants.ts:135).
 *
 * 분산: [오늘, +2일(이번주 안), +10일(이번달·이번주 밖), +40일(이번달 밖)]
 *   → '오늘' 칩: 1건 / '이번주' 칩: 2건(오늘+2일) / '이번달' 칩: 3건(+10일까지) 기대.
 *     (월 경계에 따라 +10/+40 분포는 달라질 수 있음 — 실행 로그의 실제 날짜로 판단)
 *
 * 안전장치: 원본을 orderdate-backup/<orderId>에 저장 → --restore로 복원.
 * 실행:
 *   node scripts/seed-orderdate-spread.mjs <storeId>            # 분산 시드 + 백업
 *   node scripts/seed-orderdate-spread.mjs <storeId> --restore  # 복원
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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
const UNSHIPPED = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];
const BACKUP = 'orderdate-backup';
const OFFSETS = [0, 2, 10, 40]; // 오늘 / 이번주 안 / 이번달·이번주밖 / 이번달 밖

if (!storeId) {
  console.error('사용법: node scripts/seed-orderdate-spread.mjs <storeId> [--restore]');
  process.exit(1);
}

function dateStrAfter(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function restore() {
  console.log('=== 주문 배송예정일 분산 시드 복원 (--restore) ===\n');
  const backups = await db.collection(BACKUP).get();
  if (backups.empty) { console.log('복원할 백업이 없습니다.'); return; }
  for (const b of backups.docs) {
    const { orderId, requestedDeliveryDate } = b.data();
    await db.doc(`orders/${orderId}`).update({
      requestedDeliveryDate: requestedDeliveryDate ?? FieldValue.delete(),
    });
    await b.ref.delete();
    console.log(`  ♻  ${orderId} → ${requestedDeliveryDate ?? '(삭제·원래없음)'}`);
  }
  console.log('\n✅ 복원 완료.');
}

async function seed() {
  console.log('=== M2 #235 날짜 칩 육안용 — 배송예정일 분산 시드 ===\n');
  const snap = await db.collection('orders').where('storeId', '==', storeId).get();
  const targets = snap.docs
    .filter((d) => {
      const x = d.data();
      return x.saleType !== 'group' && UNSHIPPED.includes(x.status);
    })
    .slice(0, OFFSETS.length);

  if (targets.length === 0) { console.log('미발송 일반 주문이 없습니다.'); return; }

  for (let i = 0; i < targets.length; i++) {
    const d = targets[i];
    const x = d.data();
    const offset = OFFSETS[i];
    const dateStr = dateStrAfter(offset);
    const bref = db.doc(`${BACKUP}/${d.id}`);
    if (!(await bref.get()).exists) {
      await bref.set({ orderId: d.id, requestedDeliveryDate: x.requestedDeliveryDate ?? null });
    }
    await d.ref.update({ requestedDeliveryDate: `${dateStr}T00:00:00.000Z` });
    const tag = offset === 0 ? '오늘' : `+${offset}일`;
    console.log(`  ✅ ${d.id} · ${x.productName ?? '(상품명없음)'} → ${dateStr} (${tag})`);
  }

  console.log(`\n✅ ${targets.length}건 분산. [주문]>[처리 필요] 탭에서 날짜 칩 전환 시 개수 변화 확인:`);
  console.log(`   오늘=${dateStrAfter(0)} · 이번주안=${dateStrAfter(2)} · +10일=${dateStrAfter(10)} · +40일=${dateStrAfter(40)}`);
  console.log('   복원: node scripts/seed-orderdate-spread.mjs ' + storeId + ' --restore');
}

(isRestore ? restore() : seed())
  .then(() => process.exit(0))
  .catch((e) => { console.error('오류:', e); process.exit(1); });
