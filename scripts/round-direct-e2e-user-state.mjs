// 회차 E2E 세션 수명주기 검증용 사용자 상태 변경 도구.
// 비운영 fixture 가드를 통과한 이번 실행의 fixture 사용자 문서에서만 인증 상태 필드를
// 바꾸고, 성공·실패·예외 모든 경로에서 원래 값으로 되돌린 뒤 read-back으로 확인한다.
import { validateFixtureEnvironment } from './round-direct-e2e-fixtures.mjs';

const PROJECTS = new Set(['chromium', 'mobile']);
const ROLES = new Set(['consumer', 'seller', 'driver']);
const MUTABLE_FIELDS = new Set(['suspended', 'driverApproved']);
const ABSENT = Symbol('absent');

export function roundDirectUserId(runId, project, role) {
  if (!PROJECTS.has(project)) throw new Error(`허용되지 않은 E2E project입니다: ${project}`);
  if (!ROLES.has(role)) throw new Error(`허용되지 않은 E2E 역할입니다: ${role}`);
  return `round-direct-e2e-${runId}-${project}-${role}`;
}

export function assertUserStatePatch(patch) {
  const entries = Object.entries(patch ?? {});
  if (entries.length === 0) throw new Error('변경할 사용자 상태 필드가 없습니다.');
  for (const [field, value] of entries) {
    if (!MUTABLE_FIELDS.has(field)) throw new Error(`변경할 수 없는 사용자 필드입니다: ${field}`);
    if (typeof value !== 'boolean') throw new Error(`${field} 값은 boolean이어야 합니다.`);
  }
  return entries;
}

async function firestoreUserStore(environment, env) {
  const rawCredential = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ?? '';
  const withoutBom =
    rawCredential.charCodeAt(0) === 0xfeff ? rawCredential.slice(1) : rawCredential;
  const { cert, deleteApp, initializeApp } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp(
    { credential: cert(JSON.parse(withoutBom)), projectId: environment.projectId },
    `round-direct-user-state-${environment.runId}-${Date.now()}`,
  );
  const db = getFirestore(app);
  return {
    async get(userId) {
      const snapshot = await db.doc(`users/${userId}`).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async update(userId, fields) {
      const data = Object.fromEntries(
        Object.entries(fields).map(([field, value]) => [
          field,
          value === ABSENT ? FieldValue.delete() : value,
        ]),
      );
      await db.doc(`users/${userId}`).update(data);
    },
    async close() {
      await deleteApp(app);
    },
  };
}

function sameAsPrevious(current, previous) {
  return Object.entries(previous).every(([field, value]) =>
    value === ABSENT ? !(field in current) : current[field] === value,
  );
}

/**
 * fixture 사용자 상태를 잠시 바꾼 채 callback을 실행하고, 어떤 경로로 끝나든 원래 값으로
 * 복원한다. 복원이나 read-back이 실패하면 숨기지 않고 오류로 올린다.
 */
export async function withRoundDirectUserState(
  { project, role, patch, env = process.env, openStore = null },
  callback,
) {
  const environment = validateFixtureEnvironment(env, { requireServiceAccount: !openStore });
  const entries = assertUserStatePatch(patch);
  const userId = roundDirectUserId(environment.runId, project, role);
  const store = openStore
    ? await openStore(environment)
    : await firestoreUserStore(environment, env);
  let callbackError = null;
  let result;
  try {
    const before = await store.get(userId);
    if (!before) throw new Error(`fixture 사용자 문서가 없습니다: users/${userId}`);
    const previous = Object.fromEntries(
      entries.map(([field]) => [field, field in before ? before[field] : ABSENT]),
    );
    await store.update(userId, Object.fromEntries(entries));
    try {
      result = await callback({ userId });
    } catch (error) {
      callbackError = error;
    }
    try {
      await store.update(userId, previous);
      const restored = await store.get(userId);
      if (!restored || !sameAsPrevious(restored, previous)) {
        throw new Error(`fixture 사용자 상태 복원 read-back이 일치하지 않습니다: users/${userId}`);
      }
    } catch (restoreError) {
      if (callbackError) {
        throw new AggregateError(
          [callbackError, restoreError],
          `검증 실패 후 fixture 사용자 상태 복원도 실패했습니다: users/${userId}`,
        );
      }
      throw restoreError;
    }
  } finally {
    await store.close?.();
  }
  if (callbackError) throw callbackError;
  return result;
}

export const USER_STATE_ABSENT = ABSENT;
