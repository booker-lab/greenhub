/**
 * spec 잔여물 즉시 정리 스크립트 — seller-auth-invite.spec.ts afterAll에서 호출.
 *
 * 사용법: node scripts/cleanup-spec-residue.mjs <email1> <email2> ...
 *
 * 안전 가드:
 *  - PROTECT 리스트는 절대 삭제 안 함 (defensive)
 *  - 패턴 화이트리스트(*-sec-*@example.com)에 매칭되는 이메일만 삭제
 *  - 인자 비면 즉시 종료 (no-op)
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

const PROTECT_EMAILS = ['seller@test.com', 'consumer@test.com'];
const ALLOWED_PATTERN = /^(consumer|driver)-sec-\d+@example\.com$/;

const targets = process.argv.slice(2).filter(Boolean);
if (targets.length === 0) {
  console.log('[cleanup-spec-residue] no emails passed, no-op.');
  process.exit(0);
}

async function main() {
  let userDeleted = 0;
  let tokenDeleted = 0;
  let skipped = 0;

  for (const email of targets) {
    if (PROTECT_EMAILS.includes(email)) {
      console.warn(`[cleanup-spec-residue] PROTECT skip: ${email}`);
      skipped++;
      continue;
    }
    if (!ALLOWED_PATTERN.test(email)) {
      console.warn(`[cleanup-spec-residue] pattern mismatch skip: ${email}`);
      skipped++;
      continue;
    }
    const snap = await db.collection('users').where('email', '==', email).get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
      const tok = db.doc(`refreshTokens/${d.id}`);
      const tokSnap = await tok.get();
      if (tokSnap.exists) {
        batch.delete(tok);
        tokenDeleted++;
      }
      userDeleted++;
    }
    await batch.commit();
  }

  console.log(`[cleanup-spec-residue] users=${userDeleted} tokens=${tokenDeleted} skipped=${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
