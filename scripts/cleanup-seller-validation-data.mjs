import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = getFirestore(
  initializeApp({
    credential: resolveCredential(),
  }),
);

const args = process.argv.slice(2);
const storeId = args.find((arg) => !arg.startsWith('--'));
const apply = args.includes('--apply');
const includeDailyCaps = args.includes('--include-daily-caps');

if (!storeId) {
  console.error(
    '사용법: node scripts/cleanup-seller-validation-data.mjs <storeId> [--apply] [--include-daily-caps]',
  );
  process.exit(1);
}

function resolveCredential() {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    const raw = envJson.trim();
    return cert(JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw));
  }

  const require = createRequire(import.meta.url);
  return cert(require(join(__dirname, '../apps/api/firebase-adminsdk.json')));
}

async function queryByStoreId(collectionName) {
  const snapshot = await db.collection(collectionName).where('storeId', '==', storeId).get();
  return snapshot.docs;
}

async function collectTargets() {
  const collectionNames = ['products', 'orders', 'payments', 'settlements'];
  if (includeDailyCaps) collectionNames.push('dailyCaps');

  const targets = new Map();
  for (const collectionName of collectionNames) {
    targets.set(collectionName, await queryByStoreId(collectionName));
  }

  const groupProductConfigDocs = [];
  for (const productDoc of targets.get('products') ?? []) {
    const configDoc = await db.doc(`groupProductConfig/${productDoc.id}`).get();
    if (configDoc.exists) groupProductConfigDocs.push(configDoc);
  }
  targets.set('groupProductConfig', groupProductConfigDocs);

  return targets;
}

function summarizeDocs(collectionName, docs) {
  console.log(`  ${collectionName}: ${docs.length}건`);
  for (const doc of docs.slice(0, 5)) {
    const data = doc.data();
    const label = data.name ?? data.productName ?? data.status ?? data.date ?? '';
    console.log(`    - ${doc.id}${label ? ` · ${label}` : ''}`);
  }
  if (docs.length > 5) console.log(`    ... 외 ${docs.length - 5}건`);
}

async function deleteTargets(targets) {
  let batch = db.batch();
  let pendingWrites = 0;

  for (const docs of targets.values()) {
    for (const doc of docs) {
      batch.delete(doc.ref);
      pendingWrites++;

      if (pendingWrites === 450) {
        await batch.commit();
        batch = db.batch();
        pendingWrites = 0;
      }
    }
  }

  if (pendingWrites > 0) await batch.commit();
}

async function main() {
  console.log(`=== 셀러 검증 데이터 정리 ${apply ? '(실행)' : '(dry-run)'} ===`);
  console.log(`storeId = ${storeId}`);
  console.log(`dailyCaps 포함 = ${includeDailyCaps ? '예' : '아니오'}\n`);

  const targets = await collectTargets();
  let total = 0;

  console.log('[삭제 예정]');
  for (const [collectionName, docs] of targets) {
    total += docs.length;
    summarizeDocs(collectionName, docs);
  }
  console.log(`\n합계 ${total}건`);

  if (!apply) {
    console.log('\n실제 삭제는 수행하지 않았습니다.');
    console.log(`실행하려면: node scripts/cleanup-seller-validation-data.mjs ${storeId} --apply`);
    if (!includeDailyCaps) {
      console.log('dailyCaps까지 지우려면 뒤에 --include-daily-caps를 추가하세요.');
    }
    return;
  }

  await deleteTargets(targets);
  console.log('\n삭제 완료');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('정리 오류:', error);
    process.exit(1);
  });
