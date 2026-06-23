/**
 * 운영 Firestore 상점 주소 1건을 보정한다.
 *
 * 기본 실행은 dry-run이며, 대상 문서를 읽고 로컬 백업을 남긴 뒤 쓰기 예정 내용만 출력한다.
 * 실제 쓰기는 --apply와 --confirm-address가 allowlist 정상 주소와 일치할 때만 수행한다.
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

const TARGET = {
  collection: 'stores',
  id: '9b2cb652-ff77-46b9-a773-e1efa78fb763',
  label: '소비자 운영 테스트 상점 주소',
  field: 'address',
  expectedName: '테스트 상점',
  approvedAddressCandidate: '경기도 이천시',
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
    confirmAddress: process.env.REPAIR_STORE_ADDRESS_CONFIRM ?? '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--dry-run') {
      args.apply = false;
    } else if (arg === '--confirm-address') {
      args.confirmAddress = argv[i + 1] ?? '';
      i += 1;
    }
  }

  return args;
}

function hasMojibake(value) {
  if (typeof value !== 'string') return false;
  return /[\uFFFD]|占|쏙|옙|�/.test(value);
}

function validateApplyArgs(args) {
  if (!args.apply) return;

  if (args.confirmAddress.trim() !== TARGET.approvedAddressCandidate) {
    throw new Error(
      `--apply에는 --confirm-address "${TARGET.approvedAddressCandidate}" 확인값이 필요합니다.`,
    );
  }
}

async function writeBackup(record) {
  const backupDir = join(rootDir, 'docs/archive/ops');
  await mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `store-address-repair-${timestamp}.json`);
  const backup = {
    exportedAt: new Date().toISOString(),
    mode: 'before-store-address-repair',
    target: {
      collection: TARGET.collection,
      id: TARGET.id,
      field: TARGET.field,
      label: TARGET.label,
    },
    existedBeforeRepair: record.exists,
    currentDocument: record.data,
    currentAddress: record.currentAddress,
    approvedAddressCandidate: TARGET.approvedAddressCandidate,
    looksBroken: record.looksBroken,
  };

  await writeFile(backupPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  return backupPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateApplyArgs(args);

  initializeApp({ credential: resolveCredential() });
  const db = getFirestore();
  const ref = db.collection(TARGET.collection).doc(TARGET.id);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : null;
  const currentAddress = data?.[TARGET.field] ?? null;
  const record = {
    exists: snap.exists,
    data,
    currentAddress,
    looksBroken: hasMojibake(currentAddress),
  };
  const backupPath = await writeBackup(record);

  console.log('운영 상점 주소 보정 점검');
  console.log(`모드: ${args.apply ? 'apply' : 'dry-run'}`);
  console.log(`문서: ${TARGET.collection}/${TARGET.id}`);
  console.log(`상점명: ${data?.name ?? '(없음)'}`);
  console.log(`대상 필드: ${TARGET.field}`);
  console.log(`현재 주소: ${currentAddress ?? '(없음)'}`);
  console.log(`정상 주소 후보: ${TARGET.approvedAddressCandidate}`);
  console.log(`깨짐 의심: ${record.looksBroken ? '예' : '아니오'}`);
  console.log(`백업 저장: ${backupPath}`);

  if (!snap.exists) {
    throw new Error(`대상 문서가 없습니다: ${TARGET.collection}/${TARGET.id}`);
  }

  if (data?.name !== TARGET.expectedName) {
    throw new Error(`상점명이 allowlist와 다릅니다: ${data?.name ?? '(없음)'}`);
  }

  if (!args.apply) {
    console.log('쓰기 없음: --apply가 없어서 Firestore를 변경하지 않았습니다.');
    return;
  }

  await ref.update({ [TARGET.field]: TARGET.approvedAddressCandidate });
  console.log('쓰기 완료: address 필드 1개만 보정했습니다.');
}

main().catch((error) => {
  console.error(`실패: ${error.message}`);
  process.exitCode = 1;
});
