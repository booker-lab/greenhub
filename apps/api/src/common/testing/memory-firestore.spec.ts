import * as admin from 'firebase-admin';
import { createMemoryFirestore } from './memory-firestore';

// 메모리 Firestore 더블의 undefined 거부가 실제 firebase-admin과 같은지 대조한다.
// 실제 쪽은 WriteBatch의 동기 검증만 쓴다(네트워크 없음). 같은 입력으로 거부 여부와 필드 경로를 비교한다.

type Data = Record<string, unknown>;
type WriteOp = 'set' | 'setMerge' | 'update' | 'create';

const FOUND_IN_FIELD = /\(found in field "([^"]*)"\)/;

describe('메모리 Firestore 더블 쓰기 값 검증 = 실제 SDK', () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;
  const { FieldValue, Timestamp } = admin.firestore;

  beforeAll(() => {
    app = admin.initializeApp(
      { projectId: 'demo-memory-firestore-spec' },
      `memory-firestore-${Date.now()}`,
    );
    db = app.firestore();
  });

  afterAll(async () => {
    await app.delete();
  });

  /** 실제 SDK가 거부하면 그 메시지의 필드 경로, 받아들이면 null. */
  function realRejectedField(op: WriteOp, data: Data): string | null {
    const ref = db.doc('contract/doc');
    const batch = db.batch();
    try {
      if (op === 'set') batch.set(ref, data);
      else if (op === 'setMerge') batch.set(ref, data, { merge: true });
      else if (op === 'update') batch.update(ref, data);
      else batch.create(ref, data);
    } catch (error) {
      const match = FOUND_IN_FIELD.exec((error as Error).message);
      if (!match) throw error;
      return match[1];
    }
    return null;
  }

  /** 더블의 직접 쓰기·트랜잭션 쓰기 결과. 거부하면 필드 경로, 받아들이면 null. */
  async function doubleRejectedFields(op: WriteOp, data: Data): Promise<Array<string | null>> {
    const capture = async (write: () => Promise<unknown>): Promise<string | null> => {
      try {
        await write();
      } catch (error) {
        const match = FOUND_IN_FIELD.exec((error as Error).message);
        if (!match) throw error;
        return match[1];
      }
      return null;
    };
    const results: Array<string | null> = [];
    if (op !== 'create') {
      const { firestore } = createMemoryFirestore({ 'contract/doc': { existing: 1 } });
      const ref = firestore.doc('contract/doc');
      results.push(
        await capture(() =>
          op === 'set'
            ? ref.set(data)
            : op === 'setMerge'
              ? ref.set(data, { merge: true })
              : ref.update(data),
        ),
      );
    }
    const { firestore } = createMemoryFirestore(
      op === 'create' ? {} : { 'contract/doc': { existing: 1 } },
    );
    results.push(
      await capture(() =>
        firestore.runTransaction(async (tx) => {
          const ref = firestore.doc('contract/doc');
          if (op === 'set') tx.set(ref, data);
          else if (op === 'setMerge') tx.set(ref, data, { merge: true });
          else if (op === 'update') tx.update(ref, data);
          else tx.create(ref, data);
        }),
      ),
    );
    return results;
  }

  const ALL_OPS: WriteOp[] = ['set', 'setMerge', 'update', 'create'];

  const UNDEFINED_CASES: Array<[string, () => Data, string]> = [
    ['최상위 필드', () => ({ name: '장미', size: undefined }), 'size'],
    [
      '중첩 객체 필드',
      () => ({ notice: { origin: '국내산', itemName: undefined } }),
      'notice.itemName',
    ],
    ['배열 원소', () => ({ images: ['a.jpg', undefined] }), 'images.`1`'],
    [
      '배열 안 객체 필드',
      () => ({ options: [{ id: 'o1', label: undefined }] }),
      'options.`0`.label',
    ],
    ['식별자 모양이 아닌 키', () => ({ 'a.b': undefined }), '`a.b`'],
    ['한글 키', () => ({ 메모: undefined }), '`메모`'],
  ];

  it.each(UNDEFINED_CASES)(
    '%s의 undefined를 실제 SDK와 같은 필드 경로로 거부한다',
    async (_label, make, field) => {
      for (const op of ALL_OPS) {
        const real = realRejectedField(op, make());
        expect(real).toBe(field);
        const double = await doubleRejectedFields(op, make());
        expect(double.length).toBeGreaterThan(0);
        for (const rejected of double) expect(rejected).toBe(real);
      }
    },
  );

  it('거부한 쓰기는 저장하지 않는다', async () => {
    const { firestore, records } = createMemoryFirestore({ 'contract/doc': { existing: 1 } });

    await expect(firestore.doc('contract/new').set({ size: undefined })).rejects.toThrow(
      'Cannot use "undefined" as a Firestore value (found in field "size")',
    );
    await expect(firestore.doc('contract/doc').update({ size: undefined })).rejects.toThrow();
    await expect(
      firestore.runTransaction(async (tx) => {
        tx.set(firestore.doc('contract/other'), { ok: 1 });
        tx.update(firestore.doc('contract/doc'), { nested: { size: undefined } });
      }),
    ).rejects.toThrow('found in field "nested.size"');

    expect(Object.fromEntries(records)).toEqual({ 'contract/doc': { existing: 1 } });
  });

  const VALID_CASES: Array<[string, () => Data, WriteOp[]]> = [
    ['null 값', () => ({ size: null, notice: { itemName: null }, list: [null] }), ALL_OPS],
    ['Timestamp·Date', () => ({ at: Timestamp.now(), date: new Date(0) }), ALL_OPS],
    [
      'FieldValue 변환 sentinel',
      () => ({
        updatedAt: FieldValue.serverTimestamp(),
        count: FieldValue.increment(1),
        tags: FieldValue.arrayUnion('a'),
      }),
      ALL_OPS,
    ],
    // FieldValue.delete()는 실제 SDK에서도 update와 merge set에서만 허용된다.
    ['FieldValue.delete()', () => ({ size: FieldValue.delete() }), ['setMerge', 'update']],
  ];

  it.each(VALID_CASES)('%s는 실제 SDK처럼 정상 값으로 통과시킨다', async (_label, make, ops) => {
    for (const op of ops) {
      expect(realRejectedField(op, make())).toBeNull();
      for (const rejected of await doubleRejectedFields(op, make())) expect(rejected).toBeNull();
    }
  });
});
