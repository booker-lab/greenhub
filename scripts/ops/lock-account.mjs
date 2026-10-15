#!/usr/bin/env node
/**
 * 운영 사용자 계정 1개를 이메일로 찾아 잠근다(owner 수동 실행 전용 유지보수 도구).
 *
 * 입력(env):
 *   LOCK_EMAIL          대상 이메일
 *   LOCK_MODE           check | lock
 *   LOCK_EXPECTED_ROLE  선택. 값이 있고 대상 계정 role과 다르면 아무것도 바꾸지 않고 중단한다.
 *   LOCK_TARGET_FINGERPRINT  선택. sha256(uid) 앞 10자리 hex. 같은 이메일로 찾은 계정이 둘 이상이면 lock에
 *                       필수이고 일치하는 계정 하나만 잠근다. 계정이 하나여도 값이 있으면 그 계정과 일치해야 한다.
 *   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 키 경로. project_id가 운영(green-e4fe3)이 아니면 거부한다.
 *
 * check: 계정 상태 사실만 출력한다(이메일은 마스킹, 비밀번호 해시·uid는 출력하지 않는다).
 *   찾은 계정이 둘 이상이면 중단하지 않고 계정마다 fingerprint·찾은 방법(exact|normalized|emailIdentities)·
 *   저장된 이메일(마스킹)·role·정지/잠금 여부·매장 연결(판매자는 주문·상품 수)·생성/최근 로그인 시각·활성 세션 수를 출력한다.
 * lock(여러 번 실행해도 같은 결과):
 *   - users/{uid}.passwordHash를 메모리에서 만든 무작위 32바이트 값의 bcrypt 해시로 바꾼다(원문은 어디에도 남기지 않는다).
 *   - users/{uid}.suspended = true(API 로그인·refresh·Firebase custom token·JwtStrategy가 모두 거부),
 *     sessionsRevokedAt = 지금(초 단위 내림), activeSessionIds = [](기기별 세션 목록을 쓰는 배포도 즉시 거부).
 *   - refreshTokens/{uid} 문서와 하위 컬렉션(sessions 등)을 지운다.
 *   - 같은 uid의 Firebase Auth 사용자가 있으면 refresh token을 폐기하고 disabled로 바꾼다.
 *   - auditLogs에 account.locked_by_owner_maintenance 기록을 남긴다(이메일 원문 없음).
 * 사용자·매장·주문·상품 문서는 지우지 않는다. 대상이 없으면 'not found'를 출력하고 exit 0.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const EXPECTED_PROJECT_ID = 'green-e4fe3';
export const AUDIT_ACTION = 'account.locked_by_owner_maintenance';
export const BCRYPT_COST = 12;
export const MODES = Object.freeze(['check', 'lock']);
export const FINGERPRINT_LENGTH = 10;
const MATCH_ORDER = Object.freeze(['exact', 'normalized', 'emailIdentities']);
// 후보를 모두 보이기 위한 질의 상한(정상 데이터라면 1개).
const CANDIDATE_QUERY_LIMIT = 20;
const REFRESH_SUBCOLLECTION = 'sessions';

export class LockAccountError extends Error {}

// t***@d***.com 형태. 로컬 부분과 도메인 첫 라벨의 첫 글자만 남긴다.
export function maskEmail(email) {
  const value = String(email ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.');
  const label = dot === -1 ? domain : domain.slice(0, dot);
  const rest = dot === -1 ? '' : domain.slice(dot);
  return `${local[0]}***@${label[0] ?? ''}***${rest}`;
}

// API email-identity.ts와 같은 정규화·키.
export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

export function emailIdentityKey(normalizedEmail) {
  return createHash('sha256').update(normalizedEmail, 'utf8').digest('hex');
}

// uid 원문 대신 출력·대상 지정에 쓰는 식별값.
export function uidFingerprint(uid) {
  return createHash('sha256')
    .update(String(uid), 'utf8')
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
}

// API session-revocation.ts와 같이 초 단위로 내린다(같은 초의 새 로그인 토큰이 통과하도록).
export function sessionsRevokedAtMillis(nowMillis = Date.now()) {
  return Math.floor(nowMillis / 1000) * 1000;
}

function formatDate(value) {
  if (value === undefined || value === null || value === '') return 'n/a';
  let date;
  if (typeof value?.toDate === 'function') date = value.toDate();
  else if (typeof value?.toMillis === 'function') date = new Date(value.toMillis());
  else if (typeof value === 'number' || typeof value === 'string') date = new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'n/a';
  return date.toISOString();
}

// 현재 단일 기록(token), 기기별 세션 맵(sessions), 하위 컬렉션, users.activeSessionIds 중 가장 큰 값을 센다.
export function countRefreshSessions({ refreshData, subcollectionSize, activeSessionIds }) {
  let docSessions = 0;
  if (refreshData && typeof refreshData === 'object') {
    const map = refreshData.sessions;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      docSessions = Object.keys(map).length;
    } else if (typeof refreshData.token === 'string' && refreshData.token.length > 0) {
      docSessions = 1;
    }
  }
  const fromDoc = docSessions + (subcollectionSize ?? 0);
  const fromUser = Array.isArray(activeSessionIds) ? activeSessionIds.length : 0;
  return Math.max(fromDoc, fromUser);
}

export function looksLocked({ user, activeSessions, authUser }) {
  return (
    user.suspended === true &&
    user.sessionsRevokedAt !== undefined &&
    user.sessionsRevokedAt !== null &&
    activeSessions === 0 &&
    (authUser === null || authUser.disabled === true)
  );
}

function readInputs(env) {
  const email = String(env.LOCK_EMAIL ?? '').trim();
  const mode = String(env.LOCK_MODE ?? '').trim();
  const expectedRole = String(env.LOCK_EXPECTED_ROLE ?? '').trim();
  const targetFingerprint = String(env.LOCK_TARGET_FINGERPRINT ?? '')
    .trim()
    .toLowerCase();
  if (!email.includes('@')) throw new LockAccountError('LOCK_EMAIL이 비었거나 형식이 아닙니다.');
  if (!MODES.includes(mode))
    throw new LockAccountError(`LOCK_MODE는 ${MODES.join('|')} 중 하나여야 합니다.`);
  if (targetFingerprint && !/^[0-9a-f]{10}$/.test(targetFingerprint))
    throw new LockAccountError('LOCK_TARGET_FINGERPRINT는 10자리 hex여야 합니다.');
  return {
    email,
    mode,
    expectedRole: expectedRole || null,
    targetFingerprint: targetFingerprint || null,
  };
}

async function readServiceAccount(env, loadFile) {
  const path = String(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim();
  if (!path) throw new LockAccountError('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.');
  let parsed;
  try {
    parsed = JSON.parse(await loadFile(path));
  } catch {
    throw new LockAccountError('서비스 계정 키를 읽지 못했습니다.');
  }
  if (parsed?.project_id !== EXPECTED_PROJECT_ID) {
    throw new LockAccountError(
      `서비스 계정 프로젝트가 운영(${EXPECTED_PROJECT_ID})이 아니어서 거부합니다.`,
    );
  }
  return parsed;
}

async function defaultConnect(serviceAccount) {
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const app = initializeApp(
    { credential: cert(serviceAccount), projectId: serviceAccount.project_id },
    'ops-lock-account',
  );
  return { db: getFirestore(app), auth: getAuth(app), Timestamp };
}

async function defaultHashPassword(plain) {
  const bcrypt = (await import('bcrypt')).default;
  return bcrypt.hash(plain, BCRYPT_COST);
}

// 정확한 입력, 정규화 이메일, emailIdentities 연결 문서로 찾은 서로 다른 계정을 모두 돌려준다(fingerprint 순).
async function findCandidates(db, email) {
  const normalized = normalizeEmail(email);
  const matches = new Map();
  const tag = (uid, how) => {
    if (!matches.has(uid)) matches.set(uid, new Set());
    matches.get(uid).add(how);
  };
  const lookups =
    email === normalized
      ? [[email, ['exact', 'normalized']]]
      : [
          [email, ['exact']],
          [normalized, ['normalized']],
        ];
  for (const [value, hows] of lookups) {
    const snap = await db
      .collection('users')
      .where('email', '==', value)
      .limit(CANDIDATE_QUERY_LIMIT)
      .get();
    for (const doc of snap.docs) for (const how of hows) tag(doc.id, how);
  }
  const identity = await db.doc(`emailIdentities/${emailIdentityKey(normalized)}`).get();
  const linkedId = identity.exists ? identity.data()?.userId : undefined;
  if (typeof linkedId === 'string' && linkedId) tag(linkedId, 'emailIdentities');

  const candidates = [];
  for (const [uid, hows] of matches) {
    const snap = await db.doc(`users/${uid}`).get();
    if (!snap.exists) continue;
    candidates.push({
      uid,
      fingerprint: uidFingerprint(uid),
      matchedBy: MATCH_ORDER.filter((how) => hows.has(how)),
      ref: snap.ref ?? db.doc(`users/${uid}`),
      data: snap.data() ?? {},
    });
  }
  return candidates.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

function roleOf(user) {
  return typeof user.role === 'string' ? user.role : 'unknown';
}

// 계정 식별 줄: uid·이메일 원문 없이 fingerprint·찾은 방법·저장된 이메일(마스킹)·role만 출력한다.
function identityLines(candidate) {
  return [
    `fingerprint: ${candidate.fingerprint}`,
    `matchedBy: ${candidate.matchedBy.join(',')}`,
    `storedEmail: ${maskEmail(candidate.data.email)}`,
    `role: ${roleOf(candidate.data)}`,
  ];
}

// 읽기만 한다. lock 경로가 그대로 쓰도록 Auth 사용자와 세션 상태도 돌려준다.
async function inspectCandidate(db, auth, candidate) {
  const { uid, data: user } = candidate;
  const storeId = typeof user.storeId === 'string' && user.storeId ? user.storeId : null;
  const authUser = await getAuthUser(auth, uid);
  const before = await readSessionState(db, uid, user);
  const lockedBefore = looksLocked({ user, activeSessions: before.activeSessions, authUser });
  const lines = [
    `suspended: ${user.suspended === true ? 'yes' : 'no'}`,
    `storeLinked: ${storeId ? 'yes' : 'no'}`,
    `createdAt: ${formatDate(user.createdAt)}`,
    `lastLogin: ${formatDate(authUser?.metadata?.lastSignInTime)}`,
    `lastRefreshAt: ${formatDate(before.refreshData?.updatedAt)}`,
    `firebaseAuthUser: ${authUser ? 'yes' : 'no'}`,
    `alreadyLocked: ${lockedBefore ? 'yes' : 'no'}`,
    `activeRefreshSessions: ${before.activeSessions}`,
  ];
  if (roleOf(user) === 'seller' && storeId) {
    lines.push(`storeOrders: ${await countByStore(db, 'orders', storeId)}`);
    lines.push(`storeProducts: ${await countByStore(db, 'products', storeId)}`);
  }
  return { authUser, before, lockedBefore, lines };
}

async function getAuthUser(auth, uid) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

async function readSessionState(db, uid, user) {
  const refreshRef = db.doc(`refreshTokens/${uid}`);
  const refreshSnap = await refreshRef.get();
  const subSnap = await refreshRef.collection(REFRESH_SUBCOLLECTION).get();
  return {
    refreshRef,
    refreshData: refreshSnap.exists ? (refreshSnap.data() ?? {}) : null,
    activeSessions: countRefreshSessions({
      refreshData: refreshSnap.exists ? refreshSnap.data() : null,
      subcollectionSize: subSnap.size,
      activeSessionIds: user.activeSessionIds,
    }),
  };
}

async function countByStore(db, collection, storeId) {
  const snap = await db.collection(collection).where('storeId', '==', storeId).count().get();
  return snap.data().count;
}

export async function run({
  env = process.env,
  write = (line) => console.log(line),
  loadFile = (path) => readFile(path, 'utf8'),
  connect = defaultConnect,
  hashPassword = defaultHashPassword,
  now = () => Date.now(),
} = {}) {
  // 출력 직전에 입력 이메일 원문이 섞여 있으면 마스킹한다(오류 메시지 포함).
  let rawEmail = '';
  const out = (line) => {
    let text = String(line);
    if (rawEmail) {
      const pattern = new RegExp(rawEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      text = text.replace(pattern, maskEmail(rawEmail));
    }
    write(text);
  };

  try {
    const inputs = readInputs(env);
    rawEmail = inputs.email;
    const serviceAccount = await readServiceAccount(env, loadFile);
    out(`mode: ${inputs.mode}`);
    out(`email: ${maskEmail(inputs.email)}`);
    out(`project: ${serviceAccount.project_id}`);

    if (inputs.targetFingerprint) out(`targetFingerprint: ${inputs.targetFingerprint}`);

    const { db, auth, Timestamp } = await connect(serviceAccount);
    const candidates = await findCandidates(db, inputs.email);
    if (candidates.length === 0) {
      out('found: no');
      out('not found');
      return 0;
    }
    out('found: yes');
    out(`candidates: ${candidates.length}`);

    // check에서 계정이 둘 이상이면 중단하지 않고 계정마다 읽기 전용 사실만 출력한다.
    if (inputs.mode === 'check' && candidates.length > 1) {
      for (const [index, candidate] of candidates.entries()) {
        out(`candidate ${index + 1}/${candidates.length}`);
        const { lines } = await inspectCandidate(db, auth, candidate);
        for (const line of [...identityLines(candidate), ...lines]) out(`  ${line}`);
        if (inputs.expectedRole) {
          const matches = roleOf(candidate.data) === inputs.expectedRole;
          out(`  roleMatchesExpected: ${matches ? 'yes' : 'no'}`);
        }
        if (inputs.targetFingerprint) {
          out(`  target: ${candidate.fingerprint === inputs.targetFingerprint ? 'yes' : 'no'}`);
        }
      }
      out(
        '같은 이메일로 찾은 계정이 둘 이상입니다. 잠그려면 lock에서 target_fingerprint로 하나를 지정하세요.',
      );
      return 0;
    }

    let target;
    if (inputs.targetFingerprint) {
      const hits = candidates.filter((c) => c.fingerprint === inputs.targetFingerprint);
      if (hits.length !== 1) {
        out(
          `target_fingerprint와 일치하는 계정이 ${hits.length}개라 아무것도 바꾸지 않고 중단합니다.`,
        );
        return 1;
      }
      [target] = hits;
    } else if (candidates.length > 1) {
      out(
        '같은 이메일로 찾은 계정이 둘 이상이라 중단합니다. check로 확인한 뒤 target_fingerprint로 하나를 지정하세요.',
      );
      return 1;
    } else {
      [target] = candidates;
    }

    const { uid, ref: userRef, data: user } = target;
    const role = roleOf(user);
    for (const line of identityLines(target)) out(line);
    if (inputs.expectedRole && inputs.expectedRole !== role) {
      out(`role이 기대값(${inputs.expectedRole})과 달라 아무것도 바꾸지 않고 중단합니다.`);
      return 1;
    }

    const { authUser, before, lockedBefore, lines } = await inspectCandidate(db, auth, target);
    for (const line of lines) out(line);

    if (inputs.mode === 'check') return 0;

    // 비밀번호 원문은 이 블록 밖으로 나가지 않는다(출력·로그·저장 없음).
    const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
    const nowMillis = now();
    await userRef.update({
      passwordHash,
      suspended: true,
      sessionsRevokedAt: Timestamp.fromMillis(sessionsRevokedAtMillis(nowMillis)),
      activeSessionIds: [],
      updatedAt: Timestamp.fromMillis(nowMillis),
    });
    // 문서와 하위 컬렉션(기기별 sessions 등)을 함께 지운다. 문서가 없어도 하위 컬렉션은 지워진다.
    await db.recursiveDelete(before.refreshRef);

    if (authUser) {
      await auth.revokeRefreshTokens(uid);
      if (authUser.disabled !== true) await auth.updateUser(uid, { disabled: true });
    }

    const auditId = randomUUID();
    await db.doc(`auditLogs/${auditId}`).set({
      id: auditId,
      action: AUDIT_ACTION,
      userId: uid,
      ip: null,
      detail: {
        role,
        alreadyLocked: lockedBefore,
        refreshSessionsRevoked: before.activeSessions,
        firebaseAuthDisabled: authUser !== null,
      },
      createdAt: Timestamp.fromMillis(nowMillis),
    });

    const after = await readSessionState(db, uid, (await userRef.get()).data() ?? {});
    out('locked: yes');
    out(`activeRefreshSessionsAfter: ${after.activeSessions}`);
    out(`firebaseAuthDisabled: ${authUser ? 'yes' : 'n/a'}`);
    return 0;
  } catch (error) {
    const message =
      error instanceof LockAccountError
        ? error.message
        : `실패: ${error?.code ?? error?.name ?? 'error'} ${error?.message ?? ''}`.trim();
    out(message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await run());
}
