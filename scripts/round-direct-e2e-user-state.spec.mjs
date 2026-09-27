import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertUserStatePatch,
  roundDirectUserId,
  USER_STATE_ABSENT,
  withRoundDirectUserState,
} from './round-direct-e2e-user-state.mjs';

const runId = 'task-6-7-run-001';

function validEnvironment(overrides = {}) {
  return {
    ROUND_DIRECT_E2E_ENABLED: 'true',
    ROUND_DIRECT_E2E_ENV: 'preview',
    ROUND_DIRECT_E2E_RUN_ID: runId,
    FIREBASE_PROJECT_ID: 'green-staging-74557',
    FIREBASE_STORAGE_BUCKET: 'green-staging-74557-e2e.appspot.com',
    ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: 'green-staging-74557',
    ROUND_DIRECT_E2E_ALLOWED_STORAGE_BUCKETS: 'green-staging-74557-e2e.appspot.com',
    ...overrides,
  };
}

function memoryStore(initial, { failRestore = false } = {}) {
  const docs = new Map(Object.entries(initial).map(([id, data]) => [id, structuredClone(data)]));
  const updates = [];
  let closed = false;
  return {
    docs,
    updates,
    get closed() {
      return closed;
    },
    async open() {
      return {
        async get(userId) {
          return docs.has(userId) ? structuredClone(docs.get(userId)) : null;
        },
        async update(userId, fields) {
          updates.push({ userId, fields });
          if (failRestore && updates.length > 1) throw new Error('복원 쓰기 실패');
          const current = docs.get(userId);
          for (const [field, value] of Object.entries(fields)) {
            if (value === USER_STATE_ABSENT) delete current[field];
            else current[field] = value;
          }
        },
        async close() {
          closed = true;
        },
      };
    },
  };
}

const sellerId = roundDirectUserId(runId, 'chromium', 'seller');

describe('회차 E2E 사용자 상태 변경 도구', () => {
  it('이번 실행·project·역할의 fixture 사용자 ID만 만든다', () => {
    assert.equal(sellerId, `round-direct-e2e-${runId}-chromium-seller`);
    assert.throws(() => roundDirectUserId(runId, 'generic', 'seller'), /허용되지 않은 E2E project/);
    assert.throws(() => roundDirectUserId(runId, 'chromium', 'admin'), /허용되지 않은 E2E 역할/);
  });

  it('suspended·driverApproved boolean 외의 변경을 거부한다', () => {
    assert.throws(() => assertUserStatePatch({}), /변경할 사용자 상태 필드가 없습니다/);
    assert.throws(() => assertUserStatePatch({ role: 'admin' }), /변경할 수 없는 사용자 필드/);
    assert.throws(() => assertUserStatePatch({ suspended: 'true' }), /boolean/);
  });

  it('비운영 harness가 꺼져 있으면 저장소를 열기 전에 거부한다', async () => {
    const store = memoryStore({ [sellerId]: { role: 'seller' } });
    await assert.rejects(
      withRoundDirectUserState(
        {
          project: 'chromium',
          role: 'seller',
          patch: { suspended: true },
          env: validEnvironment({ ROUND_DIRECT_E2E_ENABLED: 'false' }),
          openStore: store.open,
        },
        async () => undefined,
      ),
      /비운영 Preview E2E harness/,
    );
    assert.equal(store.updates.length, 0);
  });

  it('성공 경로에서 변경 후 원래 값(없던 필드는 삭제)으로 복원한다', async () => {
    const store = memoryStore({ [sellerId]: { role: 'seller', driverApproved: true } });
    const seen = await withRoundDirectUserState(
      {
        project: 'chromium',
        role: 'seller',
        patch: { suspended: true, driverApproved: false },
        env: validEnvironment(),
        openStore: store.open,
      },
      async ({ userId }) => structuredClone(store.docs.get(userId)),
    );
    assert.equal(seen.suspended, true);
    assert.equal(seen.driverApproved, false);
    assert.deepEqual(store.docs.get(sellerId), { role: 'seller', driverApproved: true });
    assert.equal(store.closed, true);
  });

  it('검증이 실패해도 복원한 뒤 원래 오류를 올린다', async () => {
    const store = memoryStore({ [sellerId]: { role: 'seller', suspended: false } });
    await assert.rejects(
      withRoundDirectUserState(
        {
          project: 'chromium',
          role: 'seller',
          patch: { suspended: true },
          env: validEnvironment(),
          openStore: store.open,
        },
        async () => {
          throw new Error('세션이 여전히 유효함');
        },
      ),
      /세션이 여전히 유효함/,
    );
    assert.deepEqual(store.docs.get(sellerId), { role: 'seller', suspended: false });
  });

  it('복원이 실패하면 숨기지 않고 원래 오류와 함께 올린다', async () => {
    const store = memoryStore({ [sellerId]: { role: 'seller' } }, { failRestore: true });
    await assert.rejects(
      withRoundDirectUserState(
        {
          project: 'chromium',
          role: 'seller',
          patch: { suspended: true },
          env: validEnvironment(),
          openStore: store.open,
        },
        async () => {
          throw new Error('세션이 여전히 유효함');
        },
      ),
      (error) => error instanceof AggregateError && error.errors.length === 2,
    );
    assert.equal(store.closed, true);
  });

  it('fixture 사용자 문서가 없으면 변경하지 않고 거부한다', async () => {
    const store = memoryStore({});
    await assert.rejects(
      withRoundDirectUserState(
        {
          project: 'chromium',
          role: 'seller',
          patch: { suspended: true },
          env: validEnvironment(),
          openStore: store.open,
        },
        async () => undefined,
      ),
      /fixture 사용자 문서가 없습니다/,
    );
    assert.equal(store.updates.length, 0);
  });
});
