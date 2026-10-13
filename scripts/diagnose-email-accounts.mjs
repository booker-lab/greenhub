/**
 * email provider 계정 진단 (읽기 전용).
 *
 * 실행: node scripts/diagnose-email-accounts.mjs
 *
 * 출력에는 건수와 마스킹한 식별자만 남긴다. 이메일은 `a***@domain`, 사용자 ID와 storeId는
 * 앞 8자만 보인다. 이름·전화번호·비밀번호 해시는 출력하지 않는다.
 *
 * 비밀번호는 기본으로 대조하지 않는다. 특정 값(예: 회전 전 테스트 비밀번호)이 아직 쓰이는지
 * 확인해야 할 때만 운영자가 DIAGNOSE_CHECK_PASSWORD 환경 변수로 값 하나를 준다.
 * 그 값은 출력·저장하지 않고, 일치한 계정도 마스킹해 보인다.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECK_PASSWORD_ENV = 'DIAGNOSE_CHECK_PASSWORD';

export function maskEmail(email) {
  if (typeof email !== 'string' || email.trim() === '') return '(없음)';
  const value = email.trim();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '***';
  const [first] = Array.from(value.slice(0, at));
  return `${first}***@${value.slice(at + 1)}`;
}

function shortId(value) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 8) : '';
}

export function passwordHashState(hash) {
  if (typeof hash !== 'string' || hash.length === 0) return 'none';
  return hash.startsWith('$2') ? 'bcrypt' : 'other';
}

function providersOf(user) {
  const providers = user?.providers ?? [];
  return Array.isArray(providers) ? providers : [];
}

export function isEmailAccount(user) {
  return providersOf(user).includes('email');
}

export function isKakaoOnlyAccount(user) {
  const providers = providersOf(user);
  return providers.includes('kakao') && !providers.includes('email');
}

// 출력용 행. 원본 이메일·이름·전화번호·해시는 담지 않는다.
export function describeEmailAccount(id, user) {
  return {
    id: shortId(id) || '(없음)',
    email: maskEmail(user?.email),
    role: typeof user?.role === 'string' && user.role ? user.role : '(없음)',
    storeId: shortId(user?.storeId),
    hash: passwordHashState(user?.passwordHash),
    suspended: user?.suspended === true,
  };
}

export function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return counts;
}

function formatCounts(counts) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(', ') : '(없음)';
}

export function formatAccountRow(row) {
  return [
    row.id.padEnd(8),
    row.email.padEnd(28),
    row.role.padEnd(8),
    row.storeId.padEnd(8),
    row.hash.padEnd(6),
    String(row.suspended),
  ].join(' | ');
}

export function resolveCheckPassword(env = process.env) {
  const value = env[CHECK_PASSWORD_ENV];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// password가 없으면 아무 비교도 하지 않는다. 일치 결과는 마스킹한 행만 돌려준다.
export async function findPasswordMatches(accounts, password, compare) {
  if (!password) return [];
  const matches = [];
  for (const { id, user } of accounts) {
    if (passwordHashState(user?.passwordHash) !== 'bcrypt') continue;
    if (await compare(password, user.passwordHash)) matches.push(describeEmailAccount(id, user));
  }
  return matches;
}

async function main() {
  const require = createRequire(import.meta.url);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const serviceAccount = require(join(scriptDir, '../apps/api/firebase-adminsdk.json'));
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  const all = await db.collection('users').get();
  console.log(`총 users: ${all.size}건\n`);

  const emailAccounts = all.docs
    .map((d) => ({ id: d.id, user: d.data() }))
    .filter(({ user }) => isEmailAccount(user));
  const rows = emailAccounts.map(({ id, user }) => describeEmailAccount(id, user));

  console.log(`email provider 계정: ${rows.length}건`);
  console.log(`  role별: ${formatCounts(countBy(rows, 'role'))}`);
  console.log(`  비밀번호 해시: ${formatCounts(countBy(rows, 'hash'))}`);
  console.log(`  정지(suspended): ${rows.filter((r) => r.suspended).length}건\n`);

  console.log('id       | email(마스킹)                | role     | storeId  | hash   | suspended');
  console.log('---------|------------------------------|----------|----------|--------|----------');
  for (const row of rows) console.log(formatAccountRow(row));

  console.log('\n=== 지정 비밀번호 대조 ===');
  const checkPassword = resolveCheckPassword();
  if (!checkPassword) {
    console.log(
      `  (건너뜀 — ${CHECK_PASSWORD_ENV} 미설정. 기본으로는 비밀번호를 대조하지 않는다.)`,
    );
  } else {
    const bcrypt = require(join(scriptDir, '../apps/api/node_modules/bcrypt'));
    const matches = await findPasswordMatches(emailAccounts, checkPassword, (pw, hash) =>
      bcrypt.compare(pw, hash),
    );
    console.log(`  지정 값과 일치: ${matches.length}건 (값은 출력하지 않음)`);
    for (const m of matches) {
      console.log(`  ⚠️  ${m.id} ${m.email} (role=${m.role}, storeId=${m.storeId || '-'})`);
    }
  }

  console.log('\n=== Firestore 외 — kakao provider 계정 카운트 ===');
  const kakaoOnly = all.docs.filter((d) => isKakaoOnlyAccount(d.data())).length;
  console.log(`  kakao 단독: ${kakaoOnly}건`);
  console.log(`  providers 미설정: ${all.size - rows.length - kakaoOnly}건`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
