import type * as admin from 'firebase-admin';
import { migrateProducts } from './migrate-products-ai-fields';

// 실제 Firestore처럼 커밋한 배치에 다시 쓰거나 다시 커밋하면 실패하는 가짜 DB.
function fakeDb(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const batches: Array<{ ops: string[]; committed: boolean }> = [];
  const db = {
    collection: () => ({
      get: () =>
        Promise.resolve({
          size: docs.length,
          docs: docs.map((d) => ({ ref: { id: d.id }, data: () => d.data })),
        }),
    }),
    batch: () => {
      const state = { ops: [] as string[], committed: false };
      batches.push(state);
      return {
        update: (ref: { id: string }) => {
          if (state.committed)
            throw new Error('Cannot modify a WriteBatch that has been committed.');
          state.ops.push(ref.id);
        },
        commit: () => {
          if (state.committed) {
            return Promise.reject(new Error('Cannot modify a WriteBatch that has been committed.'));
          }
          state.committed = true;
          return Promise.resolve([]);
        },
      };
    },
  };
  return { db: db as unknown as admin.firestore.Firestore, batches };
}

describe('migrateProducts', () => {
  it('499건을 넘으면 커밋한 배치를 다시 쓰지 않고 새 배치로 이어간다', async () => {
    const docs: Array<{ id: string; data: Record<string, unknown> }> = Array.from(
      { length: 1000 },
      (_, i) => ({ id: `p${i}`, data: { name: `상품${i}`, description: 'd', colors: ['red'] } }),
    );
    docs.push({ id: 'done', data: { name: 'x', content: { headline: 'x' } } });
    const { db, batches } = fakeDb(docs);

    const result = await migrateProducts(db, () => {});

    expect(result).toEqual({ total: 1001, migrated: 1000, skipped: 1 });
    const used = batches.filter((b) => b.ops.length > 0);
    expect(used.map((b) => b.ops.length)).toEqual([499, 499, 2]);
    expect(used.every((b) => b.committed)).toBe(true);
    expect(used.flatMap((b) => b.ops)).not.toContain('done');
  });

  it('바꿀 문서가 없으면 커밋하지 않는다', async () => {
    const { db, batches } = fakeDb([{ id: 'done', data: { content: {} } }]);

    await expect(migrateProducts(db, () => {})).resolves.toEqual({
      total: 1,
      migrated: 0,
      skipped: 1,
    });
    expect(batches.some((b) => b.committed)).toBe(false);
  });
});
