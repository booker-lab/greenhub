/**
 * seller_test@greenhub.dev 이메일 로그인 계정 삭제
 *
 * - users/7ec0e26b-... 삭제 (이메일 로그인 차단)
 * - stores/80189070-... 는 보존 (운영 셀러 시드 데이터)
 * - refreshTokens/7ec0e26b-... 도 정리 (탈취된 토큰 방지)
 *
 * 실행 전 dry-run으로 영향 범위 출력. 실제 삭제는 --apply 플래그 필요.
 *
 * 사용법:
 *   node scripts/delete-seller-test-account.mjs           # dry-run
 *   node scripts/delete-seller-test-account.mjs --apply   # 실제 삭제
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const serviceAccount = require(join(__dirname, '../apps/api/firebase-adminsdk.json'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const TARGET_EMAIL = 'seller_test@greenhub.dev';
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`모드: ${APPLY ? '🔴 APPLY (실제 삭제)' : '🟢 DRY-RUN'}`);
  console.log(`대상: ${TARGET_EMAIL}\n`);

  const snap = await db.collection('users').where('email', '==', TARGET_EMAIL).get();
  if (snap.empty) {
    console.log('  대상 없음 — 이미 정리됨');
    return;
  }

  for (const d of snap.docs) {
    const u = d.data();
    console.log(`[users/${d.id}]`);
    console.log(`  email      : ${u.email}`);
    console.log(`  role       : ${u.role}`);
    console.log(`  storeId    : ${u.storeId}`);
    console.log(`  providers  : ${JSON.stringify(u.providers)}`);
    console.log(`  createdAt  : ${u.createdAt?.toDate?.()?.toISOString() ?? u.createdAt}`);

    // refreshTokens/{userId} — 발급된 활성 토큰 무효화
    const tokRef = db.doc(`refreshTokens/${d.id}`);
    const tokSnap = await tokRef.get();
    console.log(`  refreshToken 문서: ${tokSnap.exists ? '존재 (삭제 예정)' : '없음'}`);

    // store 영향 — ownerId가 본 user 가리키는지
    if (u.storeId) {
      const storeSnap = await db.doc(`stores/${u.storeId}`).get();
      if (storeSnap.exists) {
        const s = storeSnap.data();
        console.log(`  연결된 stores/${u.storeId}:`);
        console.log(`    name    : ${s.name}`);
        console.log(`    ownerId : ${s.ownerId}${s.ownerId === d.id ? ' (← 본 user — 삭제 후 dangling)' : ' (← 본 user 아님 — 영향 없음)'}`);
        console.log(`    isActive: ${s.isActive}`);
      }
    }

    if (APPLY) {
      const batch = db.batch();
      batch.delete(d.ref);
      if (tokSnap.exists) batch.delete(tokRef);
      await batch.commit();
      console.log(`  ✅ 삭제 완료 (users + refreshTokens)`);
    } else {
      console.log(`  [dry-run] users/${d.id} + refreshTokens/${d.id} 삭제 예정`);
    }
  }

  console.log('\n완료. 보존된 자원: stores/80189070-... (난플렉스)');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
