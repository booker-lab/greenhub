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

const TARGET_EMAIL = 'seller@test.com';
const MEMORY_STORE_ID = '9b2cb652-ff77-46b9-a773-e1efa78fb763';

async function main() {
  console.log('=== seller@test.com 계정 상태 ===');
  const userByEmail = await db.collection('users').where('email', '==', TARGET_EMAIL).get();
  if (userByEmail.empty) {
    console.log('  users/{email==seller@test.com}: 없음');
  } else {
    userByEmail.docs.forEach(d => {
      const u = d.data();
      console.log(`  users/${d.id}`);
      console.log(`    email: ${u.email}`);
      console.log(`    role: ${u.role}`);
      console.log(`    storeId: ${u.storeId}`);
      console.log(`    providers: ${JSON.stringify(u.providers)}`);
      console.log(`    passwordHash: ${u.passwordHash ? u.passwordHash.slice(0, 10) + '...' : '(없음)'}`);
      console.log(`    suspended: ${u.suspended}`);
    });
  }

  console.log(`\n=== 메모리 storeId(${MEMORY_STORE_ID.slice(0,8)}...) 존재 여부 ===`);
  const memStore = await db.doc(`stores/${MEMORY_STORE_ID}`).get();
  console.log(`  stores/${MEMORY_STORE_ID.slice(0,8)}...: ${memStore.exists ? '존재' : '없음'}`);
  if (memStore.exists) {
    const s = memStore.data();
    console.log(`    name: ${s.name}`);
    console.log(`    ownerId: ${s.ownerId}`);
  }

  console.log('\n=== 전체 stores 목록 ===');
  const allStores = await db.collection('stores').get();
  console.log(`  총 ${allStores.size}건`);
  allStores.docs.forEach(d => {
    const s = d.data();
    console.log(`  ${d.id.slice(0,8)}... | name="${s.name ?? '(이름없음)'}" ownerId=${(s.ownerId ?? '').slice(0,8)}...`);
  });

  console.log('\n=== seller role 유저 전체 ===');
  const sellers = await db.collection('users').where('role', '==', 'seller').get();
  console.log(`  총 ${sellers.size}건`);
  sellers.docs.forEach(d => {
    const u = d.data();
    console.log(`  ${d.id.slice(0,8)}... | ${u.email ?? '(이메일없음)'} | storeId=${(u.storeId ?? '').slice(0,8)}... | providers=${JSON.stringify(u.providers)}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
