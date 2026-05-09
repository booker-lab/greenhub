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

const COMMON_WEAK = [
  'test1234', 'password', 'password123', '12345678', 'admin1234', 'qwerty12',
  'seller1234', 'consumer1234', 'greenlove', 'greenhub', 'tazan1234'
];

async function main() {
  const all = await db.collection('users').get();
  console.log(`총 users: ${all.size}건\n`);

  const emailProviders = all.docs.filter(d => {
    const p = d.data().providers ?? [];
    return Array.isArray(p) && p.includes('email');
  });

  console.log(`email provider 계정: ${emailProviders.length}건\n`);
  console.log('id          | email                     | role     | storeId      | hash prefix      | suspended');
  console.log('------------|---------------------------|----------|--------------|------------------|----------');

  const weakHits = [];
  for (const d of emailProviders) {
    const u = d.data();
    const hashPrefix = u.passwordHash ? u.passwordHash.slice(0, 12) : '(없음)';
    const sid = (u.storeId ?? '').slice(0, 8);
    console.log(
      `${d.id.slice(0,8)}... | ${(u.email ?? '').padEnd(25)} | ${(u.role ?? '').padEnd(8)} | ${sid.padEnd(12)} | ${hashPrefix.padEnd(16)} | ${u.suspended ?? false}`
    );

    if (u.passwordHash && u.passwordHash.startsWith('$2')) {
      for (const pw of COMMON_WEAK) {
        const ok = await bcrypt.compare(pw, u.passwordHash);
        if (ok) {
          weakHits.push({ id: d.id, email: u.email, role: u.role, storeId: u.storeId, password: pw });
          break;
        }
      }
    }
  }

  console.log('\n=== 약한 비밀번호 매칭 결과 ===');
  if (weakHits.length === 0) {
    console.log('  (없음 — common-weak 사전 기준)');
  } else {
    weakHits.forEach(h => {
      console.log(`  ⚠️  ${h.email} (role=${h.role}, storeId=${(h.storeId ?? '').slice(0,8)}...) → password="${h.password}"`);
    });
  }

  // Firebase Auth에 잔여 테스트 계정?
  console.log('\n=== Firestore 외 — kakao provider 계정 카운트 ===');
  const kakaoOnly = all.docs.filter(d => {
    const p = d.data().providers ?? [];
    return Array.isArray(p) && p.includes('kakao') && !p.includes('email');
  });
  console.log(`  kakao 단독: ${kakaoOnly.length}건`);
  console.log(`  providers 미설정: ${all.size - emailProviders.length - kakaoOnly.length}건`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
