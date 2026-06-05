/**
 * 운영 Firestore에 저장된 깨진 표시명 2건을 보정한다.
 *
 * 기본은 dry-run이다. 실제 쓰기는 --apply와 정상값 2개가 모두 있을 때만 수행한다.
 *
 * 사용 예:
 *   node scripts/ops/repair-mojibake-data.mjs --dry-run
 *   node scripts/ops/repair-mojibake-data.mjs --apply --store-name "정상 상호명" --user-name "정상 이름" --seller-name "정상 판매자명"
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

const TARGETS = {
  store: {
    collection: 'stores',
    id: '9b2cb652-ff77-46b9-a773-e1efa78fb763',
    field: 'name',
    label: 'VF-008 판매자 상호',
  },
  user: {
    collection: 'users',
    id: '69dcfab6-4dca-43c0-952d-908001257168',
    field: 'name',
    label: 'VF-011 소비자 이름',
  },
  seller: {
    collection: 'users',
    id: '424b9334-cc05-41b0-a451-840e88733446',
    field: 'name',
    label: 'VF-008 연결 판매자 이름',
  },
};

function resolveCredential() {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    const raw = envJson.trim();
    const json = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return cert(JSON.parse(json));
  }

  const require = createRequire(import.meta.url);
  return cert(require(join(rootDir, 'apps/api/firebase-adminsdk.json')));
}

function parseArgs(argv) {
  const args = {
    apply: false,
    storeName: process.env.REPAIR_STORE_NAME ?? '',
    userName: process.env.REPAIR_USER_NAME ?? '',
    sellerName: process.env.REPAIR_SELLER_NAME ?? '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--dry-run') {
      args.apply = false;
    } else if (arg === '--store-name') {
      args.storeName = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--user-name') {
      args.userName = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--seller-name') {
      args.sellerName = argv[i + 1] ?? '';
      i += 1;
    }
  }

  return args;
}

function hasMojibake(value) {
  if (typeof value !== 'string') return false;
  return /[\uFFFD]|占|쏙|옙/.test(value);
}

function validateApplyArgs(args) {
  if (!args.apply) return;

  const missing = [];
  if (!args.storeName.trim()) missing.push('--store-name');
  if (!args.userName.trim()) missing.push('--user-name');
  if (!args.sellerName.trim()) missing.push('--seller-name');

  if (missing.length > 0) {
    throw new Error(`--apply에는 정상값이 필요합니다: ${missing.join(', ')}`);
  }
}

async function readTarget(db, target) {
  const ref = db.collection(target.collection).doc(target.id);
  const snap = await ref.get();
  return { ref, exists: snap.exists, data: snap.exists ? snap.data() : null };
}

async function writeBackup(records) {
  const backupDir = join(rootDir, 'docs/archive/ops');
  await mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `mojibake-repair-${timestamp}.json`);
  const backup = records.map((record) => ({
    key: record.key,
    collection: record.target.collection,
    id: record.target.id,
    field: record.target.field,
    label: record.target.label,
    existedBeforeRepair: record.exists,
    previousName: record.currentName,
    looksBroken: record.looksBroken,
  }));

  await writeFile(`${backupPath}`, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  return backupPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateApplyArgs(args);

  initializeApp({ credential: resolveCredential() });
  const db = getFirestore();

  const store = await readTarget(db, TARGETS.store);
  const user = await readTarget(db, TARGETS.user);
  const seller = await readTarget(db, TARGETS.seller);
  const records = [
    { key: 'store', target: TARGETS.store, ...store },
    { key: 'user', target: TARGETS.user, ...user },
    { key: 'seller', target: TARGETS.seller, ...seller },
  ].map(({ ref: _ref, ...record }) => ({
    ...record,
    currentName: record.data?.[record.target.field] ?? null,
    looksBroken: hasMojibake(record.data?.[record.target.field]),
  }));

  console.log('운영 mojibake 데이터 보정 점검');
  console.log(`모드: ${args.apply ? 'apply' : 'dry-run'}`);

  for (const record of records) {
    console.log('');
    console.log(`[${record.target.label}]`);
    console.log(`문서: ${record.target.collection}/${record.target.id}`);
    console.log(`존재: ${record.exists ? '예' : '아니오'}`);
    console.log(`현재 ${record.target.field}: ${record.currentName ?? '(없음)'}`);
    console.log(`깨짐 의심: ${record.looksBroken ? '예' : '아니오'}`);
  }

  if (!args.apply) {
    console.log('');
    console.log('쓰기 없음: --apply가 없어서 Firestore를 변경하지 않았습니다.');
    return;
  }

  for (const record of records) {
    if (!record.exists) {
      throw new Error(`대상 문서가 없습니다: ${record.target.collection}/${record.target.id}`);
    }
  }

  const backupPath = await writeBackup(records);
  console.log('');
  console.log(`백업 저장: ${backupPath}`);

  await store.ref.update({ [TARGETS.store.field]: args.storeName.trim() });
  await user.ref.update({ [TARGETS.user.field]: args.userName.trim() });
  await seller.ref.update({ [TARGETS.seller.field]: args.sellerName.trim() });

  console.log('쓰기 완료: allowlist 대상 3건의 name 필드만 보정했습니다.');
}

main().catch((error) => {
  console.error(`실패: ${error.message}`);
  process.exitCode = 1;
});
