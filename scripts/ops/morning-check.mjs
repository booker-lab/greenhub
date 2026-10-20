#!/usr/bin/env node
/**
 * 아침 운영 점검 수집기(읽기 전용). 설계: docs/specs/ops/morning-ops-check.md §3·§4·§5.
 *
 * 실행: GREENHUB_OPS_READONLY_KEY=<점검 전용 열쇠 경로> node scripts/ops/morning-check.mjs
 *
 * 차단 장치(§4-2)
 * - 열쇠 경로는 환경 변수 GREENHUB_OPS_READONLY_KEY에서만 받는다. GOOGLE_APPLICATION_CREDENTIALS나
 *   운영 Admin 키 파일(firebase-adminsdk.json) 같은 다른 열쇠로 넘어가지 않는다.
 * - 열쇠의 client_email이 로컬 설정(~/.claude/greenhub-ops/config.json의 serviceAccountEmail)과 다르거나,
 *   project_id가 운영(green-e4fe3)이 아니면 Firestore에 연결하지 않고 S0으로 멈춘다.
 * - 모든 조회는 허용 목록 필드만 select()/getAll fieldMask로 가져온다. 이 파일에는 쓰기 호출이 없다(spec으로 고정).
 *
 * 출력: 판정 보고 JSON 한 덩어리(stdout). 같은 내용을 ~/.claude/greenhub-ops/reports/YYYY-MM-DD.json에 저장하고
 *   30일 지난 보고는 지운다. 보고에는 주문번호·가게 이름·금액·건수만 담고, 계정 이메일·열쇠 내용·사용자 id는 넣지 않는다.
 * 종료 코드: 0 = 점검 완료(이상이 있어도 0), 1 = S0 🔴(멈춤·읽기 실패). 어느 쪽이든 JSON은 낸다.
 *
 * config.json 모양(사람이 S0에서 만든다): { "serviceAccountEmail": "...", "keyCreatedAt": "YYYY-MM-DD" }
 */
import { readdir, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordReport } from './morning-check-history.mjs';
import {
  DAY_MS,
  evaluateAll,
  IN_PROGRESS_ORDER_STATUSES,
  selectRounds,
  THRESHOLDS,
} from './morning-check-rules.mjs';

export const EXPECTED_PROJECT_ID = 'green-e4fe3';
export const KEY_ENV = 'GREENHUB_OPS_READONLY_KEY';
export const OPS_DIR = join(homedir(), '.claude', 'greenhub-ops');
export const CONFIG_PATH = join(OPS_DIR, 'config.json');
export const REPORTS_DIR = join(OPS_DIR, 'reports');
/** 운영 Admin 키 파일 이름. 이 이름의 파일은 경로가 어디든 받지 않는다. */
export const ADMIN_KEY_BASENAME = 'firebase-adminsdk.json';
const APP_NAME = 'greenhub-ops-readonly';
const GET_ALL_CHUNK = 100;

/**
 * 허용 목록(§3-3). 조회마다 이 중 필요한 필드만 고른다. 목록에 없는 필드는 Firestore가 보내지 않는다.
 * 이름·전화·이메일·주소·메모·사용자 id 필드는 넣지 않는다(spec이 금지 목록으로 검사).
 */
export const FIELD_ALLOWLIST = Object.freeze({
  settlements: ['status', 'storeId', 'orderNumber', 'netAmount', 'platformFeeRate', 'paidAt', 'settledAt'],
  orders: [
    'status',
    'storeId',
    'orderNumber',
    'roundId',
    'deliveryMethod',
    'driverId',
    'totalAmount',
    'updatedAt',
    'requestedDeliveryDate',
    'deliveryHold.heldAt',
    'deliveryHold.resolvedAt',
    'deliveryHold.reasonCode',
  ],
  payments: ['status', 'refundedAt', 'refundAmount'],
  stores: ['name', 'status', 'commissionRate'],
  saleRounds: ['storeId', 'name', 'status', 'schedule.deliveryStartAt', 'schedule.deliveryEndAt'],
  users: ['role', 'driverApproved', 'suspended', 'createdAt'],
  invites: ['expiresAt', 'usedAt', 'revokedAt', 'createdAt'],
  auditLogs: ['action', 'createdAt'],
  operationIssues: ['type', 'severity', 'storeId', 'createdAt'],
});

const FIELDS = Object.freeze({
  paidSettlements: ['status', 'storeId', 'orderNumber', 'netAmount', 'platformFeeRate', 'paidAt'],
  recentSettlements: ['storeId', 'platformFeeRate', 'settledAt'],
  ordersById: ['status', 'storeId', 'orderNumber'],
  paymentsById: ['status', 'refundedAt', 'refundAmount'],
  stores: ['name', 'status', 'commissionRate'],
  saleRounds: ['storeId', 'name', 'status', 'schedule.deliveryStartAt', 'schedule.deliveryEndAt'],
  roundOrders: ['status', 'storeId', 'orderNumber', 'roundId', 'deliveryMethod', 'driverId', 'totalAmount', 'updatedAt'],
  openOrders: ['status', 'storeId', 'orderNumber', 'requestedDeliveryDate', 'updatedAt', 'roundId'],
  heldOrders: [
    'status',
    'storeId',
    'orderNumber',
    'deliveryHold.heldAt',
    'deliveryHold.resolvedAt',
    'deliveryHold.reasonCode',
  ],
  drivers: ['role', 'driverApproved', 'suspended', 'createdAt'],
  invites: ['expiresAt', 'usedAt', 'revokedAt', 'createdAt'],
  auditLogs: ['action', 'createdAt'],
  operationIssues: ['type', 'severity', 'storeId', 'createdAt'],
});

/** 차단 장치가 멈출 때 쓰는 오류. 메시지에 열쇠 내용·이메일·경로를 넣지 않는다. */
export class OpsCheckStop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ── 차단 장치(§4-2) ──────────────────────────────────────────────────────────

/**
 * 점검 전용 열쇠를 읽고 검사한다. 통과하면 { key, keyCreatedAt }.
 * env·readText를 주입받는다(spec이 가짜 파일로 검사). 다른 열쇠 경로로 넘어가는 분기가 없다.
 */
export async function loadReadonlyCredentials({ env, readText, configPath = CONFIG_PATH }) {
  const keyPath = typeof env?.[KEY_ENV] === 'string' ? env[KEY_ENV].trim() : '';
  if (!keyPath) {
    throw new OpsCheckStop('key-path-missing', `열쇠 경로 환경 변수 ${KEY_ENV}가 없어 멈춥니다(다른 열쇠로 넘어가지 않음).`);
  }
  if (basename(keyPath).toLowerCase() === ADMIN_KEY_BASENAME) {
    throw new OpsCheckStop('admin-key-path', '운영 Admin 키 파일 이름이라 멈춥니다. 점검 전용 열쇠만 씁니다.');
  }

  let config;
  try {
    config = JSON.parse(await readText(configPath));
  } catch {
    throw new OpsCheckStop('config-unreadable', '로컬 설정 config.json을 읽지 못해 멈춥니다.');
  }
  const expectedEmail = typeof config?.serviceAccountEmail === 'string' ? config.serviceAccountEmail.trim() : '';
  if (!expectedEmail) {
    throw new OpsCheckStop('config-email-missing', 'config.json에 serviceAccountEmail이 없어 멈춥니다.');
  }

  let key;
  try {
    key = JSON.parse(await readText(keyPath));
  } catch {
    throw new OpsCheckStop('key-unreadable', '점검 열쇠 파일을 읽지 못해 멈춥니다.');
  }
  if (key?.type !== 'service_account' || typeof key.client_email !== 'string') {
    throw new OpsCheckStop('key-malformed', '점검 열쇠 파일 모양이 서비스 계정 열쇠가 아니라 멈춥니다.');
  }
  if (key.client_email.trim() !== expectedEmail) {
    throw new OpsCheckStop('key-email-mismatch', '열쇠의 계정이 config.json의 점검 계정과 달라 멈춥니다(예상하지 않은 열쇠).');
  }
  if (key.project_id !== EXPECTED_PROJECT_ID) {
    throw new OpsCheckStop('key-project-mismatch', '열쇠의 프로젝트가 운영 프로젝트가 아니라 멈춥니다.');
  }
  return { key, keyCreatedAt: config.keyCreatedAt ?? null };
}

// ── 조회(읽기만) ─────────────────────────────────────────────────────────────

function docData(doc) {
  return { id: doc.id, ...(doc.data() ?? {}) };
}

/** 허용 목록 안 필드만 select()해서 조회한다. 목록 밖 필드를 요청하면 조회 전에 멈춘다. */
export async function selectQuery(db, collection, fields, build = (query) => query) {
  assertAllowed(collection, fields);
  const snap = await build(db.collection(collection)).select(...fields).get();
  return snap.docs.map(docData);
}

/** 문서 id로 getAll하되 fieldMask로 허용 필드만 받는다. 없는 문서는 결과에서 빠진다. */
export async function getAllMasked(db, collection, ids, fields) {
  assertAllowed(collection, fields);
  const result = {};
  for (let i = 0; i < ids.length; i += GET_ALL_CHUNK) {
    const refs = ids.slice(i, i + GET_ALL_CHUNK).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs, { fieldMask: fields });
    for (const snap of snaps) {
      if (snap.exists) result[snap.id] = docData(snap);
    }
  }
  return result;
}

function assertAllowed(collection, fields) {
  const allowed = FIELD_ALLOWLIST[collection];
  if (!allowed) throw new Error(`허용 목록에 없는 컬렉션: ${collection}`);
  const extra = fields.filter((field) => !allowed.includes(field));
  if (extra.length > 0) throw new Error(`허용 목록 밖 필드: ${collection}.${extra.join(',')}`);
}

/** 읽기 오류에서 코드만 남긴다(경로·id·이메일이 섞일 수 있는 원문은 내지 않는다). */
export function describeReadError(error) {
  const code = error?.code;
  if (typeof code === 'string' && /^[A-Za-z_-]{1,40}$/.test(code)) return code;
  if (typeof code === 'number') return `code ${code}`;
  return error?.name && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : '알 수 없는 오류';
}

/**
 * §3-3 조회를 모두 한다. 출처 하나가 실패해도 나머지는 계속 읽고, 실패는 failures에 남긴다(S0 🔴).
 * 돌려주는 값은 morning-check-rules.mjs evaluateAll의 입력 모양이다.
 */
export async function collect(db, { now }) {
  const failures = [];
  const read = async (source, fn, fallback) => {
    try {
      return await fn();
    } catch (error) {
      failures.push({ source, message: describeReadError(error) });
      return fallback;
    }
  };
  const nowDate = new Date(now);

  const stores = await read('stores', () => selectQuery(db, 'stores', FIELDS.stores), []);

  const paidSettlements = await read(
    'settlements.paid',
    () => selectQuery(db, 'settlements', FIELDS.paidSettlements, (q) => q.where('status', '==', 'paid')),
    [],
  );
  const paidIds = paidSettlements.map((settlement) => settlement.id);
  const ordersById = await read('orders.byId', () => getAllMasked(db, 'orders', paidIds, FIELDS.ordersById), {});
  const paymentsById = await read(
    'payments.byId',
    () => getAllMasked(db, 'payments', paidIds, FIELDS.paymentsById),
    {},
  );

  const recentSettlements = await read(
    'settlements.recent',
    () =>
      selectQuery(db, 'settlements', FIELDS.recentSettlements, (q) =>
        q.where('settledAt', '>=', new Date(now - 30 * DAY_MS)),
      ),
    [],
  );

  // 회차 일정은 ISO 문자열이고 시차 표기(Z·+09:00)가 섞일 수 있어 문자열 범위 조회 대신 전체를 읽어 메모리에서 고른다.
  // 파일럿 규모라 읽기 수가 작다. 고른 회차만 주문을 조회한다(§3-3 "최근 7일 안이거나 오늘 시작").
  const allRounds = await read('saleRounds', () => selectQuery(db, 'saleRounds', FIELDS.saleRounds), []);
  const rounds = selectRounds(allRounds, now);
  const roundOrders = await read(
    'orders.byRound',
    async () => {
      const lists = [];
      for (const round of rounds) {
        lists.push(
          await selectQuery(db, 'orders', FIELDS.roundOrders, (q) => q.where('roundId', '==', round.id)),
        );
      }
      return lists.flat();
    },
    [],
  );

  const openOrders = await read(
    'orders.openWithoutRound',
    () =>
      selectQuery(db, 'orders', FIELDS.openOrders, (q) => q.where('status', 'in', [...IN_PROGRESS_ORDER_STATUSES])),
    [],
  );
  const openOrdersWithoutRound = openOrders.filter((order) => !order.roundId);

  const heldOrders = await read(
    'orders.held',
    () => selectQuery(db, 'orders', FIELDS.heldOrders, (q) => q.where('status', '==', 'DELIVERY_HELD')),
    [],
  );

  const drivers = await read(
    'users.drivers',
    () => selectQuery(db, 'users', FIELDS.drivers, (q) => q.where('role', '==', 'driver')),
    [],
  );

  const invites = await read(
    'invites',
    () =>
      selectQuery(db, 'invites', FIELDS.invites, (q) =>
        q.where('expiresAt', '>', nowDate).where('expiresAt', '<=', new Date(now + THRESHOLDS.inviteExpiryMs)),
      ),
    [],
  );

  const auditLogs = await read(
    'auditLogs',
    () =>
      selectQuery(db, 'auditLogs', FIELDS.auditLogs, (q) =>
        q.where('createdAt', '>=', new Date(now - THRESHOLDS.baselineDays * DAY_MS - THRESHOLDS.recentWindowMs)),
      ),
    [],
  );

  const operationIssues = await read(
    'operationIssues',
    () => selectQuery(db, 'operationIssues', FIELDS.operationIssues, (q) => q.where('status', '==', 'OPEN')),
    [],
  );

  return {
    now,
    stores,
    paidSettlements,
    ordersById,
    paymentsById,
    recentSettlements,
    rounds,
    roundOrders,
    openOrdersWithoutRound,
    heldOrders,
    drivers,
    invites,
    auditLogs,
    operationIssues,
    failures,
  };
}

// ── 실행 ─────────────────────────────────────────────────────────────────────

/** Firestore에 읽기 전용 열쇠로만 연결한다. firebase-admin은 여기서만 불러온다(spec은 부르지 않는다). */
async function openReadonlyFirestore(key) {
  const { cert, getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const existing = getApps().find((app) => app.name === APP_NAME);
  const app =
    existing ?? initializeApp({ credential: cert(key), projectId: EXPECTED_PROJECT_ID }, APP_NAME);
  return getFirestore(app);
}

/**
 * 점검 한 번. 의존성은 모두 주입 가능(spec이 가짜로 바꾼다).
 * 돌려주는 값: { exitCode, report }
 */
export async function run({
  env = process.env,
  now = Date.now(),
  readText = (path) => readFile(path, 'utf8'),
  openFirestore = openReadonlyFirestore,
  fs = { mkdir, readdir, readFile, writeFile, rm },
  reportsDir = REPORTS_DIR,
  configPath = CONFIG_PATH,
  emit = (text) => process.stdout.write(`${text}\n`),
} = {}) {
  let collected;
  try {
    const { key, keyCreatedAt } = await loadReadonlyCredentials({ env, readText, configPath });
    const db = await openFirestore(key);
    collected = { ...(await collect(db, { now })), keyCreatedAt };
  } catch (error) {
    const stop =
      error instanceof OpsCheckStop
        ? { code: error.code, message: error.message }
        : { code: 'unexpected', message: `점검 준비 중 오류: ${describeReadError(error)}` };
    collected = { now, stop };
  }

  let report = evaluateAll(collected);
  try {
    report = (await recordReport({ fs, reportsDir, report })).report;
  } catch (error) {
    report = { ...report, saveError: `보고 파일 저장 실패: ${describeReadError(error)}` };
  }
  emit(JSON.stringify(report, null, 2));

  const s0 = report.items.find((item) => item.id === 'S0');
  const failed = s0?.entries.some((entry) => entry.level === '🔴') ?? false;
  return { exitCode: failed ? 1 : 0, report };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { exitCode } = await run();
  process.exit(exitCode);
}
