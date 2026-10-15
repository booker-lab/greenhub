#!/usr/bin/env node
/**
 * 운영 사용자 계정 1개를 이메일로 찾아 잠근다(owner 수동 실행 전용 유지보수 도구).
 *
 * 입력(env):
 *   LOCK_EMAIL          대상 이메일
 *   LOCK_MODE           check | lock
 *   LOCK_EXPECTED_ROLE  선택. 값이 있고 계정 role과 다르면 아무것도 바꾸지 않고 중단한다.
 *   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 키 경로. project_id가 운영(green-e4fe3)이 아니면 거부한다.
 *
 * check: 계정 상태 사실만 출력한다(이메일은 마스킹, 비밀번호 해시·uid는 출력하지 않는다).
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
  if (!email.includes('@')) throw new LockAccountError('LOCK_EMAIL이 비었거나 형식이 아닙니다.');
  if (!MODES.includes(mode))
    throw new LockAccountError(`LOCK_MODE는 ${MODES.join('|')} 중 하나여야 합니다.`);
  return { email, mode, expectedRole: expectedRole || null };
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

// 정확한 입력, 정규화 이메일, emailIdentities 연결 문서로 찾는다. 서로 다른 계정이 둘 이상이면 중단한다.
async function findUser(db, email) {
  const normalized = normalizeEmail(email);
  const ids = new Set();
  for (const value of new Set([email, normalized])) {
    const snap = await db.collection('users').where('email', '==', value).limit(2).get();
    for (const doc of snap.docs) ids.add(doc.id);
  }
  const identity = await db.doc(`emailIdentities/${emailIdentityKey(normalized)}`).get();
  const linkedId = identity.exists ? identity.data()?.userId : undefined;
  if (typeof linkedId === 'string' && linkedId) {
    const linked = await db.doc(`users/${linkedId}`).get();
    if (linked.exists) ids.add(linkedId);
  }
  if (ids.size > 1) throw new LockAccountError('같은 이메일로 찾은 계정이 둘 이상이라 중단합니다.');
  if (ids.size === 0) return null;
  const [uid] = ids;
  const snap = await db.doc(`users/${uid}`).get();
  return snap.exists
    ? { uid, ref: snap.ref ?? db.doc(`users/${uid}`), data: snap.data() ?? {} }
    : null;
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

    const { db, auth, Timestamp } = await connect(serviceAccount);
    const found = await findUser(db, inputs.email);
    if (!found) {
      out('found: no');
      out('not found');
      return 0;
    }

    const { uid, ref: userRef, data: user } = found;
    const role = typeof user.role === 'string' ? user.role : 'unknown';
    out('found: yes');
    out(`role: ${role}`);
    if (inputs.expectedRole && inputs.expectedRole !== role) {
      out(`role이 기대값(${inputs.expectedRole})과 달라 아무것도 바꾸지 않고 중단합니다.`);
      return 1;
    }

    const storeId = typeof user.storeId === 'string' && user.storeId ? user.storeId : null;
    const authUser = await getAuthUser(auth, uid);
    const before = await readSessionState(db, uid, user);
    const lockedBefore = looksLocked({ user, activeSessions: before.activeSessions, authUser });

    out(`storeLinked: ${storeId ? 'yes' : 'no'}`);
    out(`createdAt: ${formatDate(user.createdAt)}`);
    out(`lastLogin: ${formatDate(authUser?.metadata?.lastSignInTime)}`);
    out(`lastRefreshAt: ${formatDate(before.refreshData?.updatedAt)}`);
    out(`firebaseAuthUser: ${authUser ? 'yes' : 'no'}`);
    out(`alreadyLocked: ${lockedBefore ? 'yes' : 'no'}`);
    out(`activeRefreshSessions: ${before.activeSessions}`);
    if (role === 'seller' && storeId) {
      out(`storeOrders: ${await countByStore(db, 'orders', storeId)}`);
      out(`storeProducts: ${await countByStore(db, 'products', storeId)}`);
    }

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
