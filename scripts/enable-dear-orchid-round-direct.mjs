/**
 * 디어 오키드 판매 모드 전환 준비 도구.
 *
 * 기본 실행은 읽기 전용 dry-run이다.
 * 실제 변경은 --apply와 현재 상태를 포함한 정확한 --confirm 값이 모두 있어야 한다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const EXPECTED_PROJECT_ID = 'green-e4fe3';
export const TARGET_STORE_ID = '80189070-2c3d-45f2-bc11-68a870b13951';
export const TARGET_STORE_NAME = '디어 오키드';
export const ALLOWED_SALES_MODES = Object.freeze(['legacy', 'round_direct']);

const DEFAULT_CREDENTIAL_PATH = join(__dirname, '../apps/api/firebase-adminsdk.json');
const REJECTION_CONDITIONS = Object.freeze([
  '대상 이름 조회 결과가 0건 또는 2건 이상',
  `조회 문서 ID가 ${TARGET_STORE_ID}와 불일치`,
  '문서 id·name·ownerId·status 또는 salesMode가 손상됨',
  '현재 모드가 변경 예정값과 이미 같음',
  '인증 누락 또는 프로젝트 불일치',
  '실제 변경 시 정확한 --confirm 플래그 누락 또는 불일치',
]);

export function parseOptions(argv) {
  const options = {
    apply: false,
    dryRun: false,
    targetMode: 'round_direct',
    confirmation: null,
  };
  const seen = new Set();

  for (const argument of argv) {
    const key = argument.split('=', 1)[0];
    if (seen.has(key)) throw new Error(`중복 옵션 거부: ${key}`);
    seen.add(key);

    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--apply') {
      options.apply = true;
    } else if (argument.startsWith('--target-mode=')) {
      options.targetMode = argument.slice('--target-mode='.length);
    } else if (argument.startsWith('--confirm=')) {
      options.confirmation = argument.slice('--confirm='.length) || null;
    } else {
      throw new Error(`알 수 없는 옵션 거부: ${argument}`);
    }
  }

  if (options.apply === options.dryRun) {
    throw new Error('--dry-run 또는 --apply 중 정확히 하나가 필요합니다.');
  }
  if (!ALLOWED_SALES_MODES.includes(options.targetMode)) {
    throw new Error(`변경 예정값 거부: ${options.targetMode}`);
  }
  return options;
}

export function expectedConfirmation(storeId, currentMode, targetMode) {
  return `${storeId}:${currentMode}:${targetMode}`;
}

function parseCredentialJson(raw) {
  const trimmed = raw.trim();
  const normalized = trimmed.charCodeAt(0) === 0xfeff ? trimmed.slice(1) : trimmed;
  try {
    return JSON.parse(normalized);
  } catch {
    throw new Error('인증 JSON 파싱 실패');
  }
}

export function loadCredentialRecord({
  env = process.env,
  credentialPath = DEFAULT_CREDENTIAL_PATH,
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  const envJson = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  let record;
  let source;

  if (envJson) {
    record = parseCredentialJson(envJson);
    source = 'FIREBASE_SERVICE_ACCOUNT_JSON';
  } else if (exists(credentialPath)) {
    record = parseCredentialJson(readFile(credentialPath, 'utf8'));
    source = '로컬 서비스 계정';
  } else {
    throw new Error(
      '인증 누락: FIREBASE_SERVICE_ACCOUNT_JSON 또는 apps/api/firebase-adminsdk.json이 필요합니다.',
    );
  }

  if (
    typeof record.project_id !== 'string' ||
    typeof record.client_email !== 'string' ||
    typeof record.private_key !== 'string'
  ) {
    throw new Error('인증 상태 손상: 필수 서비스 계정 필드가 없습니다.');
  }
  return { record, source };
}

function candidateFromSnapshot(snapshot) {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    data,
    salesModePresent: Object.hasOwn(data, 'salesMode'),
    updateTimeMillis: snapshot.updateTime?.toMillis() ?? null,
  };
}

function validateTarget(candidates) {
  if (candidates.length === 0) {
    throw new Error(`대상 없음: stores.name == "${TARGET_STORE_NAME}" 조회 결과가 0건입니다.`);
  }
  if (candidates.length !== 1) {
    throw new Error(
      `다중 대상 거부: stores.name == "${TARGET_STORE_NAME}" 조회 결과가 ${candidates.length}건입니다.`,
    );
  }

  const candidate = candidates[0];
  const data = candidate.data ?? {};
  if (candidate.id !== TARGET_STORE_ID) {
    throw new Error(`대상 storeId 불일치: ${candidate.id}`);
  }
  if (data.id !== TARGET_STORE_ID) {
    throw new Error('현재 상태 손상: 문서 id 필드가 대상 storeId와 다릅니다.');
  }
  if (data.name !== TARGET_STORE_NAME) {
    throw new Error('현재 상태 손상: 매장 이름이 대상 이름과 다릅니다.');
  }
  if (data.status !== 'active') {
    throw new Error('현재 상태 손상: 대상 매장이 active 상태가 아닙니다.');
  }
  if (typeof data.ownerId !== 'string' || data.ownerId.length === 0) {
    throw new Error('현재 상태 손상: ownerId가 없습니다.');
  }
  return candidate;
}

function readCurrentMode(candidate) {
  const data = candidate.data ?? {};
  const present = candidate.salesModePresent ?? Object.hasOwn(data, 'salesMode');
  const rawMode = present ? data.salesMode : undefined;

  if (rawMode == null) {
    return {
      currentMode: 'legacy',
      rawCurrentMode: rawMode === null ? 'null' : '미설정',
    };
  }
  if (!ALLOWED_SALES_MODES.includes(rawMode)) {
    throw new Error(`현재 상태 손상: 허용되지 않은 salesMode "${String(rawMode)}"`);
  }
  return { currentMode: rawMode, rawCurrentMode: rawMode };
}

export function buildTransitionPlan({ candidates, targetMode, apply, confirmation }) {
  if (!ALLOWED_SALES_MODES.includes(targetMode)) {
    throw new Error(`변경 예정값 거부: ${targetMode}`);
  }
  const candidate = validateTarget(candidates);
  const { currentMode, rawCurrentMode } = readCurrentMode(candidate);

  if (currentMode === targetMode) {
    throw new Error(`이미 ${targetMode}: 상태 변경 없이 안전하게 거부합니다.`);
  }

  const requiredConfirmation = expectedConfirmation(TARGET_STORE_ID, currentMode, targetMode);
  if (apply && !confirmation) {
    throw new Error(`확인 플래그 누락: --confirm=${requiredConfirmation}`);
  }
  if (apply && confirmation !== requiredConfirmation) {
    throw new Error(`확인 플래그 불일치: --confirm=${requiredConfirmation}`);
  }

  const rollbackConfirmation = expectedConfirmation(TARGET_STORE_ID, 'round_direct', 'legacy');
  return {
    storeId: TARGET_STORE_ID,
    storeName: TARGET_STORE_NAME,
    rawCurrentMode,
    currentMode,
    targetMode,
    requiredConfirmation,
    updateTimeMillis: candidate.updateTimeMillis,
    rollbackTargetMode: 'legacy',
    rollbackCommand:
      'node scripts/enable-dear-orchid-round-direct.mjs ' +
      `--apply --target-mode=legacy --confirm=${rollbackConfirmation}`,
  };
}

function createFirestoreGateway({ credentialRecord }) {
  const appName = '디어-오키드-판매-모드-전환';
  const existing = getApps().find((app) => app.name === appName);
  const app =
    existing ??
    initializeApp(
      {
        credential: cert(credentialRecord),
        projectId: credentialRecord.project_id,
      },
      appName,
    );
  const db = getFirestore(app);
  const targetQuery = db.collection('stores').where('name', '==', TARGET_STORE_NAME);

  return {
    async findTargets() {
      const snapshot = await targetQuery.get();
      return snapshot.docs.map(candidateFromSnapshot);
    },
    async applyTransition({ targetMode, confirmation }) {
      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(targetQuery);
        const plan = buildTransitionPlan({
          candidates: snapshot.docs.map(candidateFromSnapshot),
          targetMode,
          apply: true,
          confirmation,
        });
        transaction.update(snapshot.docs[0].ref, {
          salesMode: targetMode,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return plan;
      });
    },
  };
}

function printPlan(plan, { dryRun, projectId, credentialSource, log }) {
  log(`[판매 모드 전환 준비] 실행 모드: ${dryRun ? 'dry-run' : 'apply'}`);
  log(`프로젝트: ${projectId}`);
  log(`인증 출처: ${credentialSource}`);
  log(`대상 이름: ${plan.storeName}`);
  log(`대상 storeId: ${plan.storeId}`);
  log(
    `현재 salesMode: ${plan.rawCurrentMode}` +
      (plan.rawCurrentMode === plan.currentMode ? '' : ` (호환값 ${plan.currentMode})`),
  );
  log(`변경 예정값: ${plan.targetMode}`);
  log(`필수 확인 플래그: --confirm=${plan.requiredConfirmation}`);
  log(`롤백 대상: ${plan.rollbackTargetMode}`);
  log(`롤백 명령: ${plan.rollbackCommand}`);
  log(`거부 조건: ${REJECTION_CONDITIONS.join(' / ')}`);
  if (dryRun) log('외부 상태 변경: 없음 (조회만 수행)');
}

export async function run(
  argv,
  {
    loadCredential = loadCredentialRecord,
    connect = createFirestoreGateway,
    log = console.log,
  } = {},
) {
  const options = parseOptions(argv);
  const { record, source } = loadCredential();
  if (record.project_id !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `프로젝트 불일치: ${EXPECTED_PROJECT_ID}만 허용하며 현재 값은 ${record.project_id ?? '없음'}입니다.`,
    );
  }

  const gateway = connect({ credentialRecord: record });
  const candidates = await gateway.findTargets();
  const plan = buildTransitionPlan({
    candidates,
    targetMode: options.targetMode,
    apply: options.apply,
    confirmation: options.confirmation,
  });
  printPlan(plan, {
    dryRun: options.dryRun,
    projectId: record.project_id,
    credentialSource: source,
    log,
  });

  if (options.dryRun) return { changed: false, plan };

  const appliedPlan = await gateway.applyTransition({
    targetMode: options.targetMode,
    confirmation: options.confirmation,
  });
  log(`변경 완료: ${appliedPlan.currentMode} -> ${appliedPlan.targetMode}`);
  return { changed: true, plan: appliedPlan };
}

const isDirectRun =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(`[거부] ${error.message}`);
    process.exitCode = 1;
  });
}
