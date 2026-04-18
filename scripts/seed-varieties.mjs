/**
 * varieties 컬렉션 시드 스크립트
 * 실행: node scripts/seed-varieties.mjs
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

const varieties = require(join(__dirname, '../docs/seeds/varieties_phalaenopsis.json'));

async function seed() {
  const batch = db.batch();

  for (const variety of varieties) {
    const ref = db.collection('varieties').doc(variety.id);
    batch.set(ref, variety, { merge: true });
  }

  await batch.commit();
  console.log(`✅ varieties ${varieties.length}종 Firestore 입력 완료`);
}

seed().catch((err) => {
  console.error('❌ 시드 실패:', err);
  process.exit(1);
});
