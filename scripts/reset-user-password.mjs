/**
 * Firestore user passwordHash를 bcrypt(12 rounds)로 갱신.
 *
 * 사용법:
 *   node scripts/reset-user-password.mjs <email> <new-password>
 *
 * 안전 가드:
 *  - 이메일·비번 두 인자 필수, 누락 시 즉시 종료
 *  - bcrypt rounds = 12 (apps/api 기본값과 동일)
 *  - 매칭 user 없으면 종료
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const serviceAccount = require(join(__dirname, '../apps/api/firebase-adminsdk.json'));
const bcrypt = require(join(__dirname, '../apps/api/node_modules/bcrypt'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const [email, newPw] = process.argv.slice(2);
if (!email || !newPw) {
  console.error('Usage: node scripts/reset-user-password.mjs <email> <new-password>');
  process.exit(1);
}

const ROUNDS = 12;

async function main() {
  const snap = await db.collection('users').where('email', '==', email).get();
  if (snap.empty) {
    console.error(`NO_USER: ${email}`);
    process.exit(1);
  }
  const hash = await bcrypt.hash(newPw, ROUNDS);
  for (const d of snap.docs) {
    await d.ref.update({ passwordHash: hash });
    console.log(`updated ${d.id} (${email}) hash prefix=${hash.slice(0, 12)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
