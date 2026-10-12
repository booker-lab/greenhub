import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NotificationsService } from './notifications.service';

const ROOT = resolve(__dirname, '../../../..');

type QueryCall = { method: string; args: unknown[] };

function createFirestore(docs: Record<string, unknown>[]) {
  const calls: QueryCall[] = [];
  const collections: string[] = [];
  const query = {
    where: jest.fn((...args: unknown[]) => {
      calls.push({ method: 'where', args });
      return query;
    }),
    orderBy: jest.fn((...args: unknown[]) => {
      calls.push({ method: 'orderBy', args });
      return query;
    }),
    limit: jest.fn((...args: unknown[]) => {
      calls.push({ method: 'limit', args });
      return query;
    }),
    get: jest.fn(async () => ({ docs: docs.map((data) => ({ data: () => data })) })),
  };
  const firestore = {
    collection: jest.fn((name: string) => {
      collections.push(name);
      return query;
    }),
  };
  return { firestore, query, calls, collections };
}

function createService(firestore: unknown): NotificationsService {
  return new (NotificationsService as any)(firestore, {}, {}, {});
}

describe('사용자 알림 목록 조회', () => {
  it('현재 사용자의 알림을 생성일 내림차순 최신 50건만 서버에서 읽는다', async () => {
    const { firestore, query, calls, collections } = createFirestore([]);

    await createService(firestore).getUserNotifications('user-1');

    expect(collections).toEqual(['notifications']);
    expect(calls).toEqual([
      { method: 'where', args: ['userId', '==', 'user-1'] },
      { method: 'orderBy', args: ['createdAt', 'desc'] },
      { method: 'limit', args: [50] },
    ]);
    expect(query.get).toHaveBeenCalledTimes(1);
  });

  it('쿼리 결과 순서와 문서 데이터를 그대로 items로 돌려주고 total은 반환 건수다', async () => {
    const newer = { id: 'n-2', userId: 'user-1', createdAt: { seconds: 200 } };
    const older = { id: 'n-1', userId: 'user-1', createdAt: { seconds: 100 } };
    const { firestore } = createFirestore([newer, older]);

    await expect(createService(firestore).getUserNotifications('user-1')).resolves.toEqual({
      items: [newer, older],
      total: 2,
    });
  });

  it('알림이 없으면 빈 목록과 0을 돌려준다', async () => {
    const { firestore } = createFirestore([]);

    await expect(createService(firestore).getUserNotifications('user-1')).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it('쿼리에 필요한 복합 인덱스(userId ASC, createdAt DESC)가 선언돼 있다', () => {
    const config = JSON.parse(readFileSync(resolve(ROOT, 'firestore.indexes.json'), 'utf8')) as {
      indexes: Array<{
        collectionGroup: string;
        queryScope: string;
        fields: Array<{ fieldPath: string; order?: string }>;
      }>;
    };
    const matches = config.indexes.filter(
      (index) =>
        index.collectionGroup === 'notifications' &&
        index.queryScope === 'COLLECTION' &&
        JSON.stringify(index.fields) ===
          JSON.stringify([
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'createdAt', order: 'DESCENDING' },
          ]),
    );
    expect(matches).toHaveLength(1);
  });

  it('알림 기록 쓰기는 항상 createdAt을 넣어 정렬 쿼리에서 빠지지 않는다', () => {
    const source = readFileSync(resolve(__dirname, 'notifications.service.ts'), 'utf8');
    const writer = source.slice(source.indexOf('private async logNotification('));
    const body = writer.slice(0, writer.indexOf('return id;'));

    expect(body).toContain('this.firestore.doc(`notifications/');
    expect(body).toContain('createdAt: this.firestore.Timestamp.now(),');
  });
});
