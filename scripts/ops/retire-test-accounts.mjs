#!/usr/bin/env node
/**
 * 운영 Firestore에 남은 테스트 계정을 사람이 확인한 uid 목록으로만 정리한다(owner 로컬 실행 전용 유지보수 도구).
 *
 * 1) plan(읽기 전용, 아무것도 바꾸지 않음)
 *    GOOGLE_APPLICATION_CREDENTIALS=<서비스 계정 키> node scripts/ops/retire-test-accounts.mjs plan --out <계획 파일>
 *    email provider 계정을 아래 분류로 찾고 계정마다 연결 데이터 건수를 센 뒤, 처리 계획
 *    (delete | delete-keep-records | lock | keep)을 마스킹해 출력하고 계획 파일에 쓴다.
 *    계획 파일에는 uid 원문이 들어가므로 저장소 밖 경로에만 쓴다. reference 계정은 기본 keep이고
 *    `--include <uid 앞 8자>=lock|delete|delete-keep-records`로 지정한 계정만 계획에 넣는다.
 * 2) apply(쓰기)
 *    ... apply --plan <계획 파일> --plan-hash <plan이 출력한 값> --allow-production=green-e4fe3
 *    계획 파일의 uid만 처리한다. 계정마다 분류·연결 데이터를 다시 확인하고, 계획과 달라졌으면 그 계정은 건너뛴다.
 *
 * 분류(이메일 패턴은 후보를 찾는 데만 쓰고, 처리는 계획 파일의 uid 목록으로만 한다):
 *   spec-temp     seller-auth-invite E2E가 만든 consumer-sec-*·driver-sec-*@example.com(role이 접두와 같음)
 *   admin-test    @test.com 이메일 전용 admin(매장 없음)
 *   reference     그 밖의 테스트 도메인 이메일 계정(출력만, 기본 keep)
 *   unclassified  그 밖의 email provider 계정(출력만, 계획에 넣을 수 없음)
 *
 * delete: 남겨야 할 기록(주문·결제·청구·예약·알림·법정 보관 기록·매장·초대·운영 이슈 조치)이 하나라도 있으면
 *   lock으로 바꾼다. users/{uid}, refreshTokens/{uid}(하위 sessions 포함), emailIdentities·kakaoIdentities 연결 문서,
 *   aiUsage를 한 batch로 지우면서 같은 batch에 감사 기록(account.deleted_by_owner_maintenance)을 쓰고,
 *   그다음 Firebase Auth 사용자를 지운다. 기존 auditLogs는 지우지 않는다.
 * delete-keep-records: reference 계정을 --include로 직접 고른 경우에만 쓴다. 남길 기록이 있어도 lock으로
 *   낮추지 않고 delete와 같은 방법으로 계정만 지운다. 주문·매장 등 남길 기록은 그대로 두며(그 기록의 사용자
 *   참조는 지운 uid를 가리킨 채 남는다), 감사 기록에 남긴 기록 건수를 함께 적는다.
 * lock: lock-account.mjs와 같다(무작위 비밀번호 해시·정지·세션 폐기·Firebase Auth 폐기와 disabled·감사 기록).
 *
 * 출력에는 uid 앞 8자와 마스킹한 이메일만 남긴다. 비밀번호 해시·이름·전화번호는 출력하지 않는다.
 * 남겨 둘 기록(주문·결제 등)은 count 집계로 건수만 읽고 문서 내용은 읽지 않는다.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskEmail } from '../diagnose-email-accounts.mjs';
import { assertProductionWriteAllowed } from '../production-write-guard.mjs';
import {
  BCRYPT_COST,
  countRefreshSessions,
  emailIdentityKey,
  idPrefix,
  AUDIT_ACTION as LOCK_AUDIT_ACTION,
  looksLocked,
  normalizeEmail,
  sessionsRevokedAtMillis,
} from './lock-account.mjs';

export const SCRIPT = 'retire-test-accounts.mjs';
export const DELETE_AUDIT_ACTION = 'account.deleted_by_owner_maintenance';
export const PLAN_VERSION = 1;
export const PLAN_HASH_LENGTH = 16;
export const CATEGORIES = Object.freeze(['spec-temp', 'admin-test', 'reference', 'unclassified']);
export const TEST_EMAIL_DOMAINS = Object.freeze(['test.com', 'example.com', 'greenhub.dev']);
const PLANNABLE_CATEGORIES = Object.freeze(['spec-temp', 'admin-test', 'reference']);
const PLAN_ACTIONS = Object.freeze(['delete', 'delete-keep-records', 'lock']);
const DELETE_ACTIONS = Object.freeze(['delete', 'delete-keep-records']);
const RESULT_ORDER = Object.freeze(['deleted', 'locked', 'already-done', 'skipped', 'failed']);
const SPEC_TEMP_EMAIL = /^(consumer|driver)-sec-\d+@example\.com$/;
const REFRESH_SUBCOLLECTION = 'sessions';
const AUTH_LOOKUP_BATCH = 100;
const NESTED_SCAN_DEPTH = 8;
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const USAGE =
  '사용법: retire-test-accounts.mjs plan --out <계획 파일> [--include <uid 앞 8자>=lock|delete|delete-keep-records] | ' +
  'apply --plan <계획 파일> --plan-hash <값> [--allow-production=green-e4fe3]';

// 계정을 지우지 않고 잠가야 하는 근거 기록: [컬렉션, 사용자 uid를 담는 필드].
export const KEPT_REFERENCES = Object.freeze([
  ['orders', 'userId'],
  ['orders', 'driverId'],
  ['payments', 'userId'],
  ['orderCharges', 'userId'],
  ['checkoutReservations', 'userId'],
  ['notifications', 'userId'],
  ['legalOrderRecords', 'userId'],
  ['legalOrderRecords', 'legalHoldUpdatedBy'],
  ['legalDisputeRecords', 'userId'],
  ['legalDisputeRecords', 'legalHoldUpdatedBy'],
  ['marketingConsentLogs', 'userId'],
  ['deliveryPhotoRecords', 'legalHoldUpdatedBy'],
  ['stores', 'ownerId'],
  ['invites', 'createdBy'],
  ['invites', 'usedBy'],
  ['invites', 'revokedBy'],
]);

// 계정과 함께 지우는 연결 문서.
export const IDENTITY_REFERENCES = Object.freeze([
  ['emailIdentities', 'userId'],
  ['kakaoIdentities', 'userId'],
  ['aiUsage', 'uid'],
]);

// 필드 질의로 찾을 수 없는 중첩 참조(조치·종결 기록의 actorId 등)를 메모리에서 찾는 컬렉션.
export const NESTED_SCAN_COLLECTIONS = Object.freeze(['operationIssues']);

export class RetireError extends Error {}

function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function providersOf(user) {
  return Array.isArray(user?.providers) ? user.providers.filter(hasText) : [];
}

function emailOf(user) {
  return hasText(user?.email) && user.email.trim() ? normalizeEmail(user.email) : '';
}

function domainOf(email) {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : '';
}

// 이메일 원문 대신 계획 파일과 대조에 쓰는 값(API emailIdentities 문서 키와 같은 계산).
export function emailKeyOf(user) {
  const email = emailOf(user);
  return email ? emailIdentityKey(email) : '';
}

export function classifyAccount(user) {
  const email = emailOf(user);
  const role = hasText(user?.role) ? user.role : '';
  const providers = providersOf(user);
  const emailOnly = providers.length === 1 && providers[0] === 'email';
  if (emailOnly && !hasText(user?.storeId) && !hasText(user?.kakaoId)) {
    const spec = SPEC_TEMP_EMAIL.exec(email);
    if (spec && spec[1] === role) return 'spec-temp';
    if (role === 'admin' && domainOf(email) === 'test.com') return 'admin-test';
  }
  return TEST_EMAIL_DOMAINS.includes(domainOf(email)) ? 'reference' : 'unclassified';
}

// 남겨야 할 기록이 있으면 delete를 lock으로 낮춘다. reference는 지정한 경우에만 처리한다.
// delete-keep-records는 사람이 직접 고른 처리라 낮추지 않는다.
export function resolveAction({ category, keptTotal, requested = null }) {
  if (category === 'unclassified') return 'keep';
  const defaultAction = category === 'spec-temp' || category === 'admin-test' ? 'delete' : 'keep';
  const action = requested ?? defaultAction;
  return action === 'delete' && keptTotal > 0 ? 'lock' : action;
}

function byUid(a, b) {
  if (a.uid < b.uid) return -1;
  return a.uid > b.uid ? 1 : 0;
}

export function computePlanHash(project, entries) {
  const canonical = entries
    .map(({ uid, category, action, role, emailKey }) => ({ uid, category, action, role, emailKey }))
    .sort(byUid);
  return createHash('sha256')
    .update(JSON.stringify({ version: PLAN_VERSION, project, entries: canonical }), 'utf8')
    .digest('hex')
    .slice(0, PLAN_HASH_LENGTH);
}

export function parsePlan(text) {
  let plan;
  try {
    plan = JSON.parse(stripBom(String(text)));
  } catch {
    throw new RetireError('계획 파일이 JSON이 아닙니다.');
  }
  if (
    plan?.version !== PLAN_VERSION ||
    !hasText(plan.project) ||
    !hasText(plan.planHash) ||
    !Array.isArray(plan.entries)
  ) {
    throw new RetireError('계획 파일 형식이 아닙니다.');
  }
  const seen = new Set();
  for (const entry of plan.entries) {
    const valid =
      hasText(entry?.uid) &&
      !entry.uid.includes('/') &&
      PLANNABLE_CATEGORIES.includes(entry.category) &&
      PLAN_ACTIONS.includes(entry.action) &&
      hasText(entry.role) &&
      /^[0-9a-f]{64}$/.test(entry.emailKey ?? '');
    if (!valid || seen.has(entry.uid)) throw new RetireError('계획 파일 항목 형식이 잘못됐습니다.');
    seen.add(entry.uid);
  }
  return plan;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'plan' && command !== 'apply') throw new RetireError(USAGE);
  const args = { command, include: [], out: null, plan: null, planHash: null };
  let i = 0;
  const takeValue = (flag) => {
    const value = rest[i + 1];
    if (!hasText(value) || value.startsWith('--')) {
      throw new RetireError(`${flag} 다음에 값이 필요합니다.`);
    }
    i += 2;
    return value;
  };
  while (i < rest.length) {
    const arg = rest[i];
    if (command === 'plan' && arg === '--out') args.out = takeValue(arg);
    else if (command === 'plan' && arg === '--include') args.include.push(takeValue(arg));
    else if (command === 'apply' && arg === '--plan') args.plan = takeValue(arg);
    else if (command === 'apply' && arg === '--plan-hash') args.planHash = takeValue(arg);
    // 값 확인은 production-write-guard가 argv에서 직접 한다.
    else if (command === 'apply' && arg.startsWith('--allow-production=')) i += 1;
    else throw new RetireError(`알 수 없는 인자: ${arg}\n${USAGE}`);
  }
  return args;
}

// 일반 객체·배열 안의 문자열 값을 모두 모은다(Timestamp 같은 클래스 인스턴스는 건너뛴다).
export function collectStrings(value, found = new Set(), depth = 0) {
  if (typeof value === 'string') {
    found.add(value);
    return found;
  }
  if (depth >= NESTED_SCAN_DEPTH || !value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, found, depth + 1);
  } else if (Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value)) collectStrings(item, found, depth + 1);
  }
  return found;
}

// 출력 직전에 uid 원문을 앞 8자로 바꾼다(오류 메시지에 문서 경로가 섞여도 원문이 남지 않게).
function uidMasker(uids) {
  const list = [...new Set(uids.filter((uid) => hasText(uid) && uid.length > 8))].sort(
    (a, b) => b.length - a.length,
  );
  return (line) => {
    let text = String(line);
    for (const uid of list)
      if (text.includes(uid)) text = text.split(uid).join(`${idPrefix(uid)}…`);
    return text;
  };
}

function requireOutsideRepo(path, repoRoot) {
  if (!hasText(path))
    throw new RetireError('plan에는 --out <계획 파일 경로>가 필요합니다(저장소 밖).');
  const full = resolve(path);
  const root = resolve(repoRoot).toLowerCase();
  const lower = full.toLowerCase();
  if (lower === root || lower.startsWith(`${root}${sep}`)) {
    throw new RetireError('계획 파일에는 uid 원문이 들어가므로 저장소 밖 경로에만 씁니다.');
  }
  return full;
}

async function readServiceAccount(env, loadFile) {
  const path = String(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim();
  if (!path)
    throw new RetireError('GOOGLE_APPLICATION_CREDENTIALS(서비스 계정 키 경로)가 없습니다.');
  let parsed;
  try {
    parsed = JSON.parse(stripBom(await loadFile(path)));
  } catch {
    throw new RetireError('서비스 계정 키를 읽지 못했습니다.');
  }
  if (!hasText(parsed?.project_id))
    throw new RetireError('서비스 계정 키에 project_id가 없습니다.');
  return parsed;
}

async function defaultConnect(serviceAccount) {
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const app = initializeApp(
    { credential: cert(serviceAccount), projectId: serviceAccount.project_id },
    'ops-retire-test-accounts',
  );
  return { db: getFirestore(app), auth: getAuth(app), Timestamp };
}

async function defaultHashPassword(plain) {
  const bcrypt = (await import('bcrypt')).default;
  return bcrypt.hash(plain, BCRYPT_COST);
}

async function countWhere(db, collection, field, value) {
  const snap = await db.collection(collection).where(field, '==', value).count().get();
  return snap.data().count;
}

async function docsWhere(db, collection, field, value) {
  return (await db.collection(collection).where(field, '==', value).get()).docs;
}

function nonZero(pairs) {
  return Object.fromEntries(pairs.filter(([, count]) => count > 0));
}

function sumOf(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, count]) => `${key}:${count}`).join(',') : '-';
}

function formatDay(value) {
  let date;
  if (typeof value?.toDate === 'function') date = value.toDate();
  else if (typeof value === 'number' || typeof value === 'string') date = new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'n/a';
  return date.toISOString().slice(0, 10);
}

function latest(times) {
  const valid = times.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

// refresh 세션의 마지막 사용 시각(로그인·회전, ms). 이전 단일 기록 형식은 updatedAt을 본다.
export function lastSessionActivity(refreshData) {
  if (!refreshData || typeof refreshData !== 'object') return null;
  const times = [];
  const sessions = refreshData.sessions;
  if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
    for (const record of Object.values(sessions)) times.push(record?.createdAt, record?.rotatedAt);
  }
  if (typeof refreshData.updatedAt?.toMillis === 'function') {
    times.push(refreshData.updatedAt.toMillis());
  }
  return latest(times);
}

// Firebase Auth 사용자의 마지막 로그인·토큰 갱신 시각(ms).
export function lastAuthActivity(authUser) {
  const metadata = authUser?.metadata ?? {};
  return latest([metadata.lastSignInTime, metadata.lastRefreshTime].map((v) => Date.parse(v)));
}

function withLatest(label, millis) {
  return millis === null ? label : `${label}(최근 ${formatDay(millis)})`;
}

async function scanNestedReferences(db, uids) {
  const targets = new Set(uids);
  const hits = new Map();
  for (const name of NESTED_SCAN_COLLECTIONS) {
    const snap = await db.collection(name).get();
    for (const doc of snap.docs) {
      for (const value of collectStrings(doc.data() ?? {})) {
        if (targets.has(value)) hits.set(value, (hits.get(value) ?? 0) + 1);
      }
    }
  }
  return hits;
}

async function getAuthUsers(auth, uids) {
  const found = new Map();
  for (let i = 0; i < uids.length; i += AUTH_LOOKUP_BATCH) {
    const batch = uids.slice(i, i + AUTH_LOOKUP_BATCH).map((uid) => ({ uid }));
    const result = await auth.getUsers(batch);
    for (const record of result.users) found.set(record.uid, record);
  }
  return found;
}

async function getAuthUser(auth, uid) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

// 계정 하나의 연결 데이터. 남길 기록은 건수만, 함께 지울 연결 문서는 참조까지 모은다.
async function collectReferences(db, uid, user, nestedHits) {
  const refreshRef = db.doc(`refreshTokens/${uid}`);
  const [keptCounts, identityDocs, auditCount, refreshSnap, sessionsSnap] = await Promise.all([
    Promise.all(
      KEPT_REFERENCES.map(([collection, field]) => countWhere(db, collection, field, uid)),
    ),
    Promise.all(
      IDENTITY_REFERENCES.map(([collection, field]) => docsWhere(db, collection, field, uid)),
    ),
    countWhere(db, 'auditLogs', 'userId', uid),
    refreshRef.get(),
    refreshRef.collection(REFRESH_SUBCOLLECTION).get(),
  ]);
  const kept = nonZero([
    ...KEPT_REFERENCES.map(([collection, field], i) => [`${collection}.${field}`, keptCounts[i]]),
    ['users.storeId', hasText(user?.storeId) ? 1 : 0],
    ['operationIssues.nested', nestedHits.get(uid) ?? 0],
  ]);
  return {
    kept,
    keptTotal: sumOf(kept),
    identity: nonZero(
      IDENTITY_REFERENCES.map(([collection], i) => [collection, identityDocs[i].length]),
    ),
    identityRefs: identityDocs.flat().map((doc) => doc.ref),
    auditCount,
    refreshRef,
    refreshExists: refreshSnap.exists,
    lastSessionAt: lastSessionActivity(refreshSnap.exists ? refreshSnap.data() : null),
    sessionRefs: sessionsSnap.docs.map((doc) => doc.ref),
    activeSessions: countRefreshSessions({
      refreshData: refreshSnap.exists ? refreshSnap.data() : null,
      subcollectionSize: sessionsSnap.size,
      activeSessionIds: user?.activeSessionIds,
    }),
  };
}

function resolveIncludes(includes, accounts) {
  const requested = new Map();
  for (const spec of includes) {
    const match = /^([^=]{8})=(lock|delete|delete-keep-records)$/.exec(spec);
    if (!match)
      throw new RetireError(
        `--include 형식은 <uid 앞 8자>=lock|delete|delete-keep-records 입니다: ${spec}`,
      );
    const [, prefix, action] = match;
    const hits = accounts.filter((account) => account.uid.startsWith(prefix));
    if (hits.length !== 1) {
      throw new RetireError(
        `--include ${prefix}: 일치하는 계정이 ${hits.length}개입니다(정확히 1개여야 함).`,
      );
    }
    if (hits[0].category !== 'reference') {
      throw new RetireError(
        `--include ${prefix}: reference 계정만 지정할 수 있습니다(현재 ${hits[0].category}).`,
      );
    }
    requested.set(hits[0].uid, action);
  }
  return requested;
}

function accountLine({ uid, user, action, refs, authUser }) {
  const parts = [
    idPrefix(uid).padEnd(8),
    maskEmail(user.email).padEnd(18),
    String(user.role ?? 'n/a').padEnd(8),
    `생성=${formatDay(user.createdAt)}`,
    `정지=${user.suspended === true ? 'yes' : 'no'}`,
  ];
  if (user.role === 'driver') parts.push(`기사승인=${user.driverApproved === true ? 'yes' : 'no'}`);
  const authState = authUser ? (authUser.disabled === true ? 'disabled' : 'yes') : 'no';
  parts.push(
    withLatest(`Auth=${authState}`, authUser ? lastAuthActivity(authUser) : null),
    withLatest(`세션=${refs.activeSessions}`, refs.lastSessionAt),
    `연결문서=${formatCounts(refs.identity)}`,
    `남길기록=${formatCounts(refs.kept)}`,
    `감사기록=${refs.auditCount}`,
    `→ ${action}`,
  );
  return parts.join(' ');
}

// order에 있는 키를 그 순서로 먼저 세고, 나머지는 처음 나온 순서로 붙인다.
function countBy(items, keyOf, order = []) {
  const counts = Object.fromEntries(order.map((key) => [key, 0]));
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return nonZero(Object.entries(counts));
}

async function planCommand({
  args,
  serviceAccount,
  connect,
  out,
  setMask,
  saveFile,
  now,
  repoRoot,
}) {
  const outPath = requireOutsideRepo(args.out, repoRoot);
  const project = serviceAccount.project_id;
  const { db, auth } = await connect(serviceAccount);

  // email provider 계정만 읽는다(카카오 전용 실사용자 문서는 읽지 않는다).
  const snap = await db.collection('users').where('providers', 'array-contains', 'email').get();
  const accounts = snap.docs
    .map((doc) => ({ uid: doc.id, user: doc.data() ?? {} }))
    .map((account) => ({ ...account, category: classifyAccount(account.user) }))
    .sort(byUid);
  setMask(uidMasker(accounts.map((account) => account.uid)));
  const requested = resolveIncludes(args.include, accounts);

  const uids = accounts.map((account) => account.uid);
  const [nestedHits, authUsers] = await Promise.all([
    scanNestedReferences(db, uids),
    getAuthUsers(auth, uids),
  ]);
  for (const account of accounts) {
    account.refs = await collectReferences(db, account.uid, account.user, nestedHits);
    account.authUser = authUsers.get(account.uid) ?? null;
    account.wanted = resolveAction({
      category: account.category,
      keptTotal: 0,
      requested: requested.get(account.uid) ?? null,
    });
    account.action = resolveAction({
      category: account.category,
      keptTotal: account.refs.keptTotal,
      requested: requested.get(account.uid) ?? null,
    });
  }

  out('mode: plan (읽기 전용 — 아무것도 바꾸지 않음)');
  out(`project: ${project}`);
  out(`email provider 계정: ${accounts.length}`);
  out(`분류: ${formatCounts(countBy(accounts, (a) => a.category, CATEGORIES))}`);
  for (const category of CATEGORIES) {
    const group = accounts.filter((account) => account.category === category);
    if (group.length === 0) continue;
    const days = group
      .map((a) => formatDay(a.user.createdAt))
      .filter((d) => d !== 'n/a')
      .sort();
    const range = days.length ? ` 생성 ${days[0]}~${days[days.length - 1]}` : '';
    out('');
    out(
      `[${category}] ${group.length}건 role ${formatCounts(countBy(group, (a) => a.user.role ?? 'n/a'))}${range}`,
    );
    for (const account of group) out(`  ${accountLine(account)}`);
  }

  const planned = accounts.filter((account) => PLAN_ACTIONS.includes(account.action));
  const deletes = planned.filter((account) => DELETE_ACTIONS.includes(account.action));
  const keepRecords = planned.filter((account) => account.action === 'delete-keep-records');
  const downgraded = accounts.filter(
    (account) => account.wanted === 'delete' && account.action === 'lock',
  );
  const removal = {
    users: deletes.length,
    ...Object.fromEntries(
      IDENTITY_REFERENCES.map(([collection]) => [
        collection,
        deletes.reduce((total, a) => total + (a.refs.identity[collection] ?? 0), 0),
      ]),
    ),
    refreshTokens: deletes.filter((a) => a.refs.refreshExists).length,
    refreshSessions: deletes.reduce((total, a) => total + a.refs.sessionRefs.length, 0),
    firebaseAuth: deletes.filter((a) => a.authUser).length,
  };
  out('');
  out(`계획: ${formatCounts(countBy(accounts, (a) => a.action, [...PLAN_ACTIONS, 'keep']))}`);
  out(`남길 기록이 있어 delete 대신 lock: ${downgraded.length}`);
  out(`delete로 지울 것: ${formatCounts(removal)}`);
  out(
    `기록을 남긴 채 계정만 지울 것: ${keepRecords.length}건 (남는 기록 ${keepRecords.reduce((t, a) => t + a.refs.keptTotal, 0)}건)`,
  );
  out(
    `처리 대상 계정의 감사 기록(auditLogs, 지우지 않음): ${planned.reduce((t, a) => t + a.refs.auditCount, 0)}`,
  );

  const entries = planned
    .map((account) => ({
      uid: account.uid,
      category: account.category,
      action: account.action,
      role: account.user.role,
      emailKey: emailKeyOf(account.user),
    }))
    .sort(byUid);
  const planHash = computePlanHash(project, entries);
  const plan = {
    version: PLAN_VERSION,
    project,
    createdAt: new Date(now()).toISOString(),
    planHash,
    entries,
  };
  await saveFile(outPath, `${JSON.stringify(plan, null, 2)}\n`);
  out(`planHash: ${planHash}`);
  out(`계획 파일: ${outPath}`);
  return 0;
}

// 앞선 실행이 Firestore batch 뒤에 멈췄을 때: 같은 uid를 가리키는 남은 연결 문서와 Auth 사용자만 마저 지운다.
async function finishLeftovers({ db, auth, uid, authUser }) {
  const refreshRef = db.doc(`refreshTokens/${uid}`);
  const [identityDocs, refreshSnap, sessionsSnap] = await Promise.all([
    Promise.all(
      IDENTITY_REFERENCES.map(([collection, field]) => docsWhere(db, collection, field, uid)),
    ),
    refreshRef.get(),
    refreshRef.collection(REFRESH_SUBCOLLECTION).get(),
  ]);
  const leftovers = identityDocs.flat();
  if (leftovers.length === 0 && !refreshSnap.exists && sessionsSnap.size === 0 && !authUser) {
    return { status: 'already-done' };
  }
  const batch = db.batch();
  for (const doc of [...leftovers, ...sessionsSnap.docs]) batch.delete(doc.ref);
  batch.delete(refreshRef);
  await batch.commit();
  if (authUser) await auth.deleteUser(uid);
  return { status: 'deleted', detail: '남은 연결 문서만 정리' };
}

async function deleteAccount({ db, auth, Timestamp, entry, refs, authUser, now }) {
  const { uid } = entry;
  const auditId = randomUUID();
  const batch = db.batch();
  for (const ref of [...refs.identityRefs, ...refs.sessionRefs]) batch.delete(ref);
  batch.delete(refs.refreshRef);
  batch.delete(db.doc(`users/${uid}`));
  batch.set(db.doc(`auditLogs/${auditId}`), {
    id: auditId,
    action: DELETE_AUDIT_ACTION,
    userId: uid,
    ip: null,
    detail: {
      tool: SCRIPT,
      category: entry.category,
      role: entry.role,
      keptRecords: refs.kept,
      removed: {
        ...refs.identity,
        refreshSessions: refs.activeSessions,
        firebaseAuthUser: authUser !== null,
      },
    },
    createdAt: Timestamp.fromMillis(now()),
  });
  await batch.commit();
  if (authUser) await auth.deleteUser(uid);
  return { status: 'deleted' };
}

async function lockAccount({
  db,
  auth,
  Timestamp,
  entry,
  user,
  refs,
  authUser,
  hashPassword,
  now,
}) {
  const { uid } = entry;
  const lockedBefore = looksLocked({ user, activeSessions: refs.activeSessions, authUser });
  // 비밀번호 원문은 이 블록 밖으로 나가지 않는다(출력·로그·저장 없음).
  const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
  const nowMillis = now();
  await db.doc(`users/${uid}`).update({
    passwordHash,
    suspended: true,
    sessionsRevokedAt: Timestamp.fromMillis(sessionsRevokedAtMillis(nowMillis)),
    activeSessionIds: [],
    updatedAt: Timestamp.fromMillis(nowMillis),
  });
  await db.recursiveDelete(refs.refreshRef);
  if (authUser) {
    await auth.revokeRefreshTokens(uid);
    if (authUser.disabled !== true) await auth.updateUser(uid, { disabled: true });
  }
  const auditId = randomUUID();
  await db.doc(`auditLogs/${auditId}`).set({
    id: auditId,
    action: LOCK_AUDIT_ACTION,
    userId: uid,
    ip: null,
    detail: {
      tool: SCRIPT,
      category: entry.category,
      role: entry.role,
      alreadyLocked: lockedBefore,
      refreshSessionsRevoked: refs.activeSessions,
      firebaseAuthDisabled: authUser !== null,
    },
    createdAt: Timestamp.fromMillis(nowMillis),
  });
  return { status: 'locked', detail: lockedBefore ? '이미 잠겨 있었음' : '' };
}

async function applyEntry({ db, auth, Timestamp, entry, nestedHits, hashPassword, now }) {
  const { uid } = entry;
  const [snap, authUser] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    getAuthUser(auth, uid),
  ]);
  if (!snap.exists) {
    if (!DELETE_ACTIONS.includes(entry.action)) {
      return { status: 'skipped', detail: '사용자 문서 없음' };
    }
    return finishLeftovers({ db, auth, uid, authUser });
  }
  const user = snap.data() ?? {};
  if (
    classifyAccount(user) !== entry.category ||
    user.role !== entry.role ||
    emailKeyOf(user) !== entry.emailKey
  ) {
    return { status: 'skipped', detail: '계획 뒤 계정 정보가 바뀜' };
  }
  const refs = await collectReferences(db, uid, user, nestedHits);
  const context = { db, auth, Timestamp, entry, user, refs, authUser, hashPassword, now };
  if (entry.action === 'lock') return lockAccount(context);
  if (entry.action === 'delete' && refs.keptTotal > 0)
    return { status: 'skipped', detail: `남길 기록 발견 ${formatCounts(refs.kept)}` };
  return deleteAccount(context);
}

async function applyCommand({
  args,
  argv,
  serviceAccount,
  connect,
  out,
  setMask,
  loadFile,
  hashPassword,
  now,
}) {
  if (!hasText(args.plan)) throw new RetireError('apply에는 --plan <계획 파일>이 필요합니다.');
  if (!hasText(args.planHash))
    throw new RetireError('apply에는 --plan-hash <plan이 출력한 값>이 필요합니다.');
  let text;
  try {
    text = await loadFile(resolve(args.plan));
  } catch {
    throw new RetireError('계획 파일을 읽지 못했습니다.');
  }
  const plan = parsePlan(text);
  const project = serviceAccount.project_id;
  if (plan.project !== project) {
    throw new RetireError(
      `계획의 프로젝트(${plan.project})와 서비스 계정 프로젝트(${project})가 다릅니다.`,
    );
  }
  const planHash = computePlanHash(plan.project, plan.entries);
  if (plan.planHash !== planHash || args.planHash !== planHash) {
    throw new RetireError(
      'planHash가 계획 파일과 맞지 않아 아무것도 바꾸지 않습니다. plan을 다시 실행해 확인하세요.',
    );
  }
  try {
    assertProductionWriteAllowed(serviceAccount, { script: SCRIPT, argv });
  } catch (error) {
    throw new RetireError(error.message);
  }

  setMask(uidMasker(plan.entries.map((entry) => entry.uid)));
  out('mode: apply');
  out(`project: ${project}`);
  out(`planHash: ${planHash}`);
  out(
    `대상: ${plan.entries.length}건 ${formatCounts(countBy(plan.entries, (e) => e.action, PLAN_ACTIONS))}`,
  );
  const { db, auth, Timestamp } = await connect(serviceAccount);
  const nestedHits = await scanNestedReferences(
    db,
    plan.entries.map((entry) => entry.uid),
  );

  const statuses = [];
  for (const entry of plan.entries) {
    let result;
    try {
      result = await applyEntry({ db, auth, Timestamp, entry, nestedHits, hashPassword, now });
    } catch (error) {
      result = {
        status: 'failed',
        detail: `${error?.code ?? error?.name ?? 'error'} ${error?.message ?? ''}`.trim(),
      };
    }
    statuses.push(result.status);
    const detail = result.detail ? ` (${result.detail})` : '';
    out(
      `  ${idPrefix(entry.uid).padEnd(8)} ${entry.category} ${entry.action} → ${result.status}${detail}`,
    );
  }
  out(`결과: ${formatCounts(countBy(statuses, (status) => status, RESULT_ORDER))}`);
  return statuses.some((status) => status === 'failed' || status === 'skipped') ? 1 : 0;
}

export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  write = (line) => console.log(line),
  loadFile = (path) => readFile(path, 'utf8'),
  saveFile = (path, text) => writeFile(path, text, 'utf8'),
  connect = defaultConnect,
  hashPassword = defaultHashPassword,
  now = () => Date.now(),
  repoRoot = REPO_ROOT,
} = {}) {
  // 계정을 읽은 뒤부터는 오류 메시지까지 모든 출력에서 uid 원문을 가린다.
  let mask = (line) => String(line);
  const out = (line) => write(mask(line));
  const setMask = (next) => {
    mask = next;
  };
  try {
    const args = parseArgs(argv);
    const serviceAccount = await readServiceAccount(env, loadFile);
    const context = {
      args,
      argv,
      serviceAccount,
      connect,
      out,
      setMask,
      loadFile,
      saveFile,
      hashPassword,
      now,
      repoRoot,
    };
    return args.command === 'plan' ? await planCommand(context) : await applyCommand(context);
  } catch (error) {
    const message =
      error instanceof RetireError
        ? error.message
        : `실패: ${error?.code ?? error?.name ?? 'error'} ${error?.message ?? ''}`.trim();
    out(message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await run());
}
