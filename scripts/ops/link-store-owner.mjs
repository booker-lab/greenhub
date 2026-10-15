#!/usr/bin/env node
/**
 * 운영 매장 1개의 소유자(stores/{storeId}.ownerId)를 기존 판매자·관리자 계정 하나에 연결한다
 * (owner 수동 실행 전용 유지보수 도구).
 *
 * 입력(env):
 *   LINK_STORE_ID            대상 매장 문서 ID
 *   LINK_MODE                check | link
 *   LINK_TARGET_FINGERPRINT  link에 필수. check가 출력한 sha256(uid) 앞 10자리 hex
 *   GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 키 경로. project_id가 운영(green-e4fe3)이 아니면 거부한다.
 *
 * check(읽기 전용): 매장 이름·ownerId 앞 8자·현재 owner 사용자 문서 존재/role/정지 여부, 같은 storeId를 가진 사용자,
 *   그리고 연결 후보(role이 admin 또는 seller이고 providers에 kakao가 있거나 kakaoId가 저장된 계정)를 계정마다 fingerprint·uid 앞 8자·
 *   role·providers·저장된 이메일(마스킹)·정지 여부·전화번호 등록 여부·연결 매장·소유 매장 수·생성/최근 refresh 시각으로 출력한다.
 * link(여러 번 실행해도 같은 결과): 아래 조건을 모두 만족할 때만 한 트랜잭션에서
 *   stores/{storeId}.ownerId = uid, users/{uid}.storeId = storeId로 바꾸고 auditLogs에
 *   store.owner_linked_by_owner_maintenance(이전 ownerId 포함, 되돌리기용)를 남긴다. role은 바꾸지 않는다
 *   (관리자 계정이면 관리자 + 자기 매장 겸직 계정이 된다).
 *   - 대상 계정: role admin|seller, 정지 아님, storeId가 비었거나 이미 이 매장
 *   - 대상 계정이 소유한 다른 매장이 없음
 *   - 현재 owner가 대상이 아니면, 그 owner 사용자 문서가 없거나 정지된 계정이어야 함(활성 판매자의 매장은 옮기지 않음)
 *   - 대상 외에 이 storeId를 가진 정지되지 않은 사용자가 없음
 *   대상 계정의 기존 로그인 토큰은 storeId가 달라져 거부되므로 연결 뒤 다시 로그인해야 한다.
 * uid·이메일 원문은 출력하지 않는다.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { idPrefix, maskEmail, uidFingerprint } from './lock-account.mjs';

export const EXPECTED_PROJECT_ID = 'green-e4fe3';
export const AUDIT_ACTION = 'store.owner_linked_by_owner_maintenance';
export const MODES = Object.freeze(['check', 'link']);
export const LINKABLE_ROLES = Object.freeze(['admin', 'seller']);
// 후보·같은 매장 사용자를 보이기 위한 질의 상한.
export const ROLE_QUERY_LIMIT = 200;
export const STORE_USERS_QUERY_LIMIT = 20;
const STORE_NAME_MAX_LENGTH = 80;
const STORE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class LinkStoreOwnerError extends Error {}

function readInputs(env) {
  const storeId = String(env.LINK_STORE_ID ?? '').trim();
  const mode = String(env.LINK_MODE ?? '').trim();
  const targetFingerprint = String(env.LINK_TARGET_FINGERPRINT ?? '')
    .trim()
    .toLowerCase();
  if (!STORE_ID_PATTERN.test(storeId))
    throw new LinkStoreOwnerError('LINK_STORE_ID가 비었거나 형식이 아닙니다.');
  if (!MODES.includes(mode))
    throw new LinkStoreOwnerError(`LINK_MODE는 ${MODES.join('|')} 중 하나여야 합니다.`);
  if (targetFingerprint && !/^[0-9a-f]{10}$/.test(targetFingerprint))
    throw new LinkStoreOwnerError('LINK_TARGET_FINGERPRINT는 10자리 hex여야 합니다.');
  if (mode === 'link' && !targetFingerprint)
    throw new LinkStoreOwnerError('link에는 LINK_TARGET_FINGERPRINT가 필요합니다.');
  return { storeId, mode, targetFingerprint: targetFingerprint || null };
}

async function readServiceAccount(env, loadFile) {
  const path = String(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim();
  if (!path) throw new LinkStoreOwnerError('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.');
  let parsed;
  try {
    parsed = JSON.parse(await loadFile(path));
  } catch {
    throw new LinkStoreOwnerError('서비스 계정 키를 읽지 못했습니다.');
  }
  if (parsed?.project_id !== EXPECTED_PROJECT_ID) {
    throw new LinkStoreOwnerError(
      `서비스 계정 프로젝트가 운영(${EXPECTED_PROJECT_ID})이 아니어서 거부합니다.`,
    );
  }
  return parsed;
}

async function defaultConnect(serviceAccount) {
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const app = initializeApp(
    { credential: cert(serviceAccount), projectId: serviceAccount.project_id },
    'ops-link-store-owner',
  );
  return { db: getFirestore(app), Timestamp };
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

function roleOf(user) {
  return typeof user?.role === 'string' ? user.role : 'unknown';
}

function providersList(user) {
  return Array.isArray(user?.providers)
    ? user.providers.filter((p) => typeof p === 'string' && p)
    : [];
}

// providers에 kakao가 있거나 카카오 식별값이 저장된 계정.
function isKakaoLinked(user) {
  return (
    providersList(user).includes('kakao') ||
    (typeof user?.kakaoId === 'string' && user.kakaoId !== '')
  );
}

function storeIdOf(user) {
  return typeof user?.storeId === 'string' && user.storeId ? user.storeId : null;
}

function storeNameOf(store) {
  if (typeof store?.name !== 'string') return 'n/a';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 지우기 위한 패턴
  const name = store.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!name) return 'n/a';
  return name.length > STORE_NAME_MAX_LENGTH ? `${name.slice(0, STORE_NAME_MAX_LENGTH)}…` : name;
}

function ownerIdOf(store) {
  return typeof store?.ownerId === 'string' && store.ownerId ? store.ownerId : null;
}

// 연결 후보: role admin|seller이고 카카오로 로그인하는 계정(fingerprint 순).
async function findCandidates(db) {
  const candidates = [];
  for (const role of LINKABLE_ROLES) {
    const snap = await db
      .collection('users')
      .where('role', '==', role)
      .limit(ROLE_QUERY_LIMIT)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data() ?? {};
      if (!isKakaoLinked(data)) continue;
      candidates.push({ uid: doc.id, fingerprint: uidFingerprint(doc.id), data });
    }
  }
  return candidates.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

async function storesOwnedBy(db, uid) {
  const snap = await db.collection('stores').where('ownerId', '==', uid).limit(5).get();
  return snap.docs.map((doc) => doc.id);
}

async function usersWithStore(db, storeId) {
  const snap = await db
    .collection('users')
    .where('storeId', '==', storeId)
    .limit(STORE_USERS_QUERY_LIMIT)
    .get();
  return snap.docs
    .map((doc) => ({ uid: doc.id, fingerprint: uidFingerprint(doc.id), data: doc.data() ?? {} }))
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

async function storeLines(db, storeId, store) {
  const ownerId = ownerIdOf(store);
  const lines = [
    `storeIdPrefix: ${idPrefix(storeId)}`,
    `storeName: ${storeNameOf(store)}`,
    `storeOwnerIdPrefix: ${idPrefix(ownerId)}`,
  ];
  let owner = null;
  if (ownerId) {
    const ownerSnap = await db.doc(`users/${ownerId}`).get();
    owner = ownerSnap.exists ? (ownerSnap.data() ?? {}) : null;
    lines.push(`storeOwnerFingerprint: ${uidFingerprint(ownerId)}`);
    lines.push(`storeOwnerUserDoc: ${owner ? 'yes' : 'no'}`);
    if (owner) {
      lines.push(`storeOwnerRole: ${roleOf(owner)}`);
      lines.push(`storeOwnerSuspended: ${owner.suspended === true ? 'yes' : 'no'}`);
    }
  }
  const storeUsers = await usersWithStore(db, storeId);
  const reachedLimit = storeUsers.length >= STORE_USERS_QUERY_LIMIT;
  lines.push(`storeUsers: ${storeUsers.length}${reachedLimit ? '+ (limit reached)' : ''}`);
  for (const u of storeUsers) {
    lines.push(
      [
        '  storeUser:',
        `uidPrefix=${idPrefix(u.uid)}`,
        `fingerprint=${u.fingerprint}`,
        `role=${roleOf(u.data)}`,
        `providers=${providersList(u.data).join('/') || 'n/a'}`,
        `suspended=${u.data.suspended === true ? 'yes' : 'no'}`,
        `storeOwner=${u.uid === ownerId ? 'yes' : 'no'}`,
      ].join(' '),
    );
  }
  return { lines, ownerId, owner, storeUsers };
}

async function candidateLines(db, candidate) {
  const { uid, data } = candidate;
  const linkedStoreId = storeIdOf(data);
  const owned = await storesOwnedBy(db, uid);
  const refreshSnap = await db.doc(`refreshTokens/${uid}`).get();
  const lines = [
    `fingerprint: ${candidate.fingerprint}`,
    `uidPrefix: ${idPrefix(uid)}`,
    `role: ${roleOf(data)}`,
    `providers: ${providersList(data).join('/') || 'n/a'}`,
    `storedEmail: ${maskEmail(data.email)}`,
    `suspended: ${data.suspended === true ? 'yes' : 'no'}`,
    // 판매자 알림 문자는 users.phone으로 보낸다. 번호는 출력하지 않는다.
    `phoneSet: ${typeof data.phone === 'string' && data.phone.trim() ? 'yes' : 'no'}`,
    `storeIdPrefix: ${idPrefix(linkedStoreId)}`,
    `ownsStores: ${owned.length}${owned.length ? ` (${owned.map(idPrefix).join(',')})` : ''}`,
    `createdAt: ${formatDate(data.createdAt)}`,
    `lastRefreshAt: ${formatDate(refreshSnap.exists ? refreshSnap.data()?.updatedAt : null)}`,
  ];
  if (linkedStoreId) {
    const linkedSnap = await db.doc(`stores/${linkedStoreId}`).get();
    lines.push(`linkedStoreName: ${linkedSnap.exists ? storeNameOf(linkedSnap.data()) : 'n/a'}`);
  }
  return lines;
}

// link 전 조건. 문제가 있으면 이유 목록을 돌려준다(비었으면 진행 가능).
export function linkBlockers({ storeId, target, targetOwnedStores, ownerId, owner, storeUsers }) {
  const reasons = [];
  const user = target.data;
  if (!LINKABLE_ROLES.includes(roleOf(user)))
    reasons.push(`대상 계정 role(${roleOf(user)})이 admin|seller가 아닙니다.`);
  if (user.suspended === true) reasons.push('대상 계정이 정지 상태입니다.');
  const linked = storeIdOf(user);
  if (linked && linked !== storeId)
    reasons.push(`대상 계정이 이미 다른 매장(${idPrefix(linked)})에 연결돼 있습니다.`);
  const otherOwned = targetOwnedStores.filter((id) => id !== storeId);
  if (otherOwned.length > 0)
    reasons.push(`대상 계정이 소유한 다른 매장이 있습니다(${otherOwned.map(idPrefix).join(',')}).`);
  if (ownerId && ownerId !== target.uid && owner && owner.suspended !== true)
    reasons.push('현재 매장 owner가 정지되지 않은 기존 계정이라 옮기지 않습니다.');
  const activeOthers = storeUsers.filter((u) => u.uid !== target.uid && u.data.suspended !== true);
  if (activeOthers.length > 0)
    reasons.push(
      `대상 외에 이 매장에 연결된 활성 사용자가 있습니다(${activeOthers.map((u) => u.fingerprint).join(',')}).`,
    );
  return reasons;
}

export async function run({
  env = process.env,
  write = (line) => console.log(line),
  loadFile = (path) => readFile(path, 'utf8'),
  connect = defaultConnect,
  now = () => Date.now(),
} = {}) {
  const out = (line) => write(String(line));
  try {
    const inputs = readInputs(env);
    const serviceAccount = await readServiceAccount(env, loadFile);
    out(`mode: ${inputs.mode}`);
    out(`project: ${serviceAccount.project_id}`);
    if (inputs.targetFingerprint) out(`targetFingerprint: ${inputs.targetFingerprint}`);

    const { db, Timestamp } = await connect(serviceAccount);
    const storeRef = db.doc(`stores/${inputs.storeId}`);
    const storeSnap = await storeRef.get();
    if (!storeSnap.exists) {
      out(`storeIdPrefix: ${idPrefix(inputs.storeId)}`);
      out('storeDoc: no');
      return inputs.mode === 'check' ? 0 : 1;
    }
    const store = storeSnap.data() ?? {};
    const storeInfo = await storeLines(db, inputs.storeId, store);
    for (const line of storeInfo.lines) out(line);

    const candidates = await findCandidates(db);
    if (inputs.mode === 'check') {
      out(`kakaoCandidates: ${candidates.length}`);
      for (const [index, candidate] of candidates.entries()) {
        out(`candidate ${index + 1}/${candidates.length}`);
        for (const line of await candidateLines(db, candidate)) out(`  ${line}`);
        if (inputs.targetFingerprint) {
          out(`  target: ${candidate.fingerprint === inputs.targetFingerprint ? 'yes' : 'no'}`);
        }
      }
      return 0;
    }

    const hits = candidates.filter((c) => c.fingerprint === inputs.targetFingerprint);
    if (hits.length !== 1) {
      out(
        `target_fingerprint와 일치하는 후보가 ${hits.length}개라 아무것도 바꾸지 않고 중단합니다.`,
      );
      return 1;
    }
    const [target] = hits;
    for (const line of await candidateLines(db, target)) out(`target ${line}`);

    if (storeInfo.ownerId === target.uid && storeIdOf(target.data) === inputs.storeId) {
      out('alreadyLinked: yes');
      return 0;
    }

    const blockers = linkBlockers({
      storeId: inputs.storeId,
      target,
      targetOwnedStores: await storesOwnedBy(db, target.uid),
      ownerId: storeInfo.ownerId,
      owner: storeInfo.owner,
      storeUsers: storeInfo.storeUsers,
    });
    if (blockers.length > 0) {
      for (const reason of blockers) out(`blocked: ${reason}`);
      out('아무것도 바꾸지 않고 중단합니다.');
      return 1;
    }

    const userRef = db.doc(`users/${target.uid}`);
    const auditId = randomUUID();
    const nowMillis = now();
    const previousOwnerId = storeInfo.ownerId;
    // 읽은 뒤 바뀌었으면 쓰지 않는다(트랜잭션 안에서 다시 확인).
    await db.runTransaction(async (tx) => {
      const [storeNow, userNow] = [await tx.get(storeRef), await tx.get(userRef)];
      const storeData = storeNow.exists ? (storeNow.data() ?? {}) : null;
      const userData = userNow.exists ? (userNow.data() ?? {}) : null;
      if (
        !storeData ||
        !userData ||
        ownerIdOf(storeData) !== previousOwnerId ||
        storeIdOf(userData) !== storeIdOf(target.data) ||
        roleOf(userData) !== roleOf(target.data) ||
        userData.suspended === true
      ) {
        throw new LinkStoreOwnerError('확인 뒤 매장 또는 계정이 바뀌어 아무것도 바꾸지 않습니다.');
      }
      const at = Timestamp.fromMillis(nowMillis);
      tx.update(storeRef, { ownerId: target.uid, updatedAt: at });
      tx.update(userRef, { storeId: inputs.storeId, updatedAt: at });
      tx.set(db.doc(`auditLogs/${auditId}`), {
        id: auditId,
        action: AUDIT_ACTION,
        userId: target.uid,
        ip: null,
        detail: {
          storeId: inputs.storeId,
          previousOwnerId,
          role: roleOf(userData),
          previousUserStoreId: storeIdOf(userData),
        },
        createdAt: at,
      });
    });

    out('linked: yes');
    out(`previousOwnerIdPrefix: ${idPrefix(previousOwnerId)}`);
    out(`auditLogIdPrefix: ${idPrefix(auditId)}`);
    out('대상 계정은 판매자 앱에서 로그아웃한 뒤 다시 로그인해야 합니다.');
    return 0;
  } catch (error) {
    const message =
      error instanceof LinkStoreOwnerError
        ? error.message
        : `실패: ${error?.code ?? error?.name ?? 'error'} ${error?.message ?? ''}`.trim();
    out(message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await run());
}
