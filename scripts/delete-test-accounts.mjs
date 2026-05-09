/**
 * 테스트 계정 일괄 정리 스크립트
 *
 * 정책:
 *  - 보존: seller@test.com (e2e seller 인증 전용)
 *  - 삭제 대상:
 *      ① 명시 리스트: consumer_test@greenhub.dev, customer@test.com, e2e.consumer@test.com, test@test.com, test@example.com
 *      ② 패턴 매칭: ^(consumer|driver)-sec-\d+@example\.com$
 *  - 각 user 문서 + refreshTokens/{userId} + (storeId 가진 경우 store 정보 출력만)
 *
 * 안전 가드:
 *  - dry-run 기본. 실제 삭제는 --apply 필수
 *  - PROTECT 리스트는 절대 삭제 안 함
 *  - storeId 가진 계정은 따로 표시하고 사용자 확인 후에만 처리 (--include-stored)
 *
 * 사용법:
 *   node scripts/delete-test-accounts.mjs                  # dry-run
 *   node scripts/delete-test-accounts.mjs --apply          # 실제 삭제 (storeId 보유 계정은 스킵)
 *   node scripts/delete-test-accounts.mjs --apply --include-stored  # storeId 보유 계정도 삭제
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

const PROTECT_EMAILS = ['seller@test.com'];

const EXPLICIT_DELETE_EMAILS = [
  'consumer_test@greenhub.dev',
  'customer@test.com',
  'e2e.consumer@test.com',
  'test@test.com',
  'test@example.com',
  'consumer@test.com',
];

const PATTERN_DELETE_REGEX = /^(consumer|driver)-sec-\d+@example\.com$/;

const APPLY = process.argv.includes('--apply');
const INCLUDE_STORED = process.argv.includes('--include-stored');

function shouldDelete(email) {
  if (!email) return false;
  if (PROTECT_EMAILS.includes(email)) return false;
  if (EXPLICIT_DELETE_EMAILS.includes(email)) return true;
  if (PATTERN_DELETE_REGEX.test(email)) return true;
  return false;
}

async function main() {
  console.log(`모드: ${APPLY ? '🔴 APPLY' : '🟢 DRY-RUN'}${INCLUDE_STORED ? ' +include-stored' : ''}`);
  console.log(`보존: ${PROTECT_EMAILS.join(', ')}`);
  console.log(`명시 삭제: ${EXPLICIT_DELETE_EMAILS.join(', ')}`);
  console.log(`패턴 삭제: ${PATTERN_DELETE_REGEX}\n`);

  const all = await db.collection('users').get();
  const targets = all.docs.filter(d => shouldDelete(d.data().email));

  const noStore = targets.filter(d => !d.data().storeId);
  const withStore = targets.filter(d => d.data().storeId);

  console.log(`매칭: ${targets.length}건 (storeId 없음 ${noStore.length} / storeId 있음 ${withStore.length})`);

  if (withStore.length > 0) {
    console.log('\n=== storeId 보유 (별도 확인 필요) ===');
    for (const d of withStore) {
      const u = d.data();
      console.log(`  ${u.email} → storeId=${u.storeId} (--include-stored 없으면 스킵)`);
    }
  }

  const toDelete = INCLUDE_STORED ? targets : noStore;
  console.log(`\n실제 처리 대상: ${toDelete.length}건`);

  if (toDelete.length === 0) {
    console.log('처리할 항목 없음. 종료.');
    return;
  }

  // 보호 검증 — defensive
  for (const d of toDelete) {
    const email = d.data().email;
    if (PROTECT_EMAILS.includes(email)) {
      console.error(`❌ FATAL: 보호 대상 ${email}이 삭제 후보에 포함됨. 중단.`);
      process.exit(1);
    }
  }

  // 배치 단위 처리 (batch는 500 제한)
  const chunks = [];
  for (let i = 0; i < toDelete.length; i += 200) chunks.push(toDelete.slice(i, i + 200));

  let totalUserDeleted = 0;
  let totalTokenDeleted = 0;

  for (const chunk of chunks) {
    if (APPLY) {
      const batch = db.batch();
      for (const d of chunk) {
        batch.delete(d.ref);
        const tokRef = db.doc(`refreshTokens/${d.id}`);
        const tokSnap = await tokRef.get();
        if (tokSnap.exists) {
          batch.delete(tokRef);
          totalTokenDeleted++;
        }
        totalUserDeleted++;
      }
      await batch.commit();
    } else {
      for (const d of chunk) {
        const tokSnap = await db.doc(`refreshTokens/${d.id}`).get();
        if (tokSnap.exists) totalTokenDeleted++;
        totalUserDeleted++;
      }
    }
  }

  console.log(`\n${APPLY ? '✅ 삭제 완료' : '[dry-run]'} users: ${totalUserDeleted}건, refreshTokens: ${totalTokenDeleted}건`);
  console.log('\n남은 email-provider 계정 검증을 위해 diagnose-email-accounts.mjs 재실행 권장.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
