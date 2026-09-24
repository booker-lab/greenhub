import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { OperationsService } from '../operations/operations.service';
import { RetentionService } from './retention.service';

type Data = Record<string, any>;

function timestamp(iso: string) {
  const date = new Date(iso);
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
  };
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map<string, Data>(Object.entries(initial));

  const doc = (path: string) => ({
    path,
    get: jest.fn(async () => ({
      exists: records.has(path),
      data: () => records.get(path),
    })),
    set: jest.fn(async (data: Data) => {
      records.set(path, data);
    }),
    update: jest.fn(async (data: Data) => {
      records.set(path, { ...(records.get(path) ?? {}), ...data });
    }),
  });

  const collection = (name: string) => {
    const filters: Array<[string, string, unknown]> = [];
    const query = {
      where(field: string, operator: string, value: unknown) {
        filters.push([field, operator, value]);
        return query;
      },
      async get() {
        const docs = Array.from(records.entries())
          .filter(([path]) => path.startsWith(`${name}/`))
          .filter(([, data]) =>
            filters.every(([field, operator, value]) => {
              if (operator === '<=') {
                const actual = data[field] as { toMillis?: () => number } | undefined;
                const expected = value as { toMillis?: () => number };
                return (
                  (actual?.toMillis?.() ?? Number.POSITIVE_INFINITY) <=
                  (expected?.toMillis?.() ?? Number.NEGATIVE_INFINITY)
                );
              }
              return data[field] === value;
            }),
          )
          .map(([path, data]) => ({
            id: path.split('/')[1],
            data: () => data,
            ref: { path },
          }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
    return query;
  };

  const batch = jest.fn(() => {
    const pending: string[] = [];
    const handle = {
      delete: jest.fn((ref: { path: string }) => {
        pending.push(ref.path);
        return handle;
      }),
      commit: jest.fn(async () => {
        for (const path of pending) records.delete(path);
      }),
    };
    return handle;
  });

  const firestore = {
    doc,
    collection,
    batch,
    runTransaction: jest.fn(async (callback: (tx: Data) => Promise<unknown>) =>
      callback({
        get: (ref: ReturnType<typeof doc>) => ref.get(),
        set: (ref: ReturnType<typeof doc>, data: Data) => ref.set(data),
        update: (ref: ReturnType<typeof doc>, data: Data) => ref.update(data),
      }),
    ),
    Timestamp: {
      now: jest.fn(() => timestamp('2026-07-17T01:00:00.000Z')),
      fromDate: jest.fn((date: Date) => timestamp(date.toISOString())),
    },
  };

  return { firestore, records };
}

function operationIssues(records: Map<string, Data>) {
  return Array.from(records.entries()).filter(([path]) => path.startsWith('operationIssues/'));
}

const now = new Date('2026-07-17T01:00:00.000Z');

describe('배송 사진 보관 파기 실패의 store-scoped routing', () => {
  it('최종 삭제 실패 issue가 실제 storeId로 store-scoped 목록에 노출되고 재실행에도 멱등하다', async () => {
    const { firestore, records } = makeFirestore({
      'stores/store-safe': { ownerId: 'seller-1' },
      'deliveryPhotoRecords/photo-expired': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
        storeId: 'store-safe',
        orderId: 'order-safe',
        storagePath: 'deliveryPhotos/order-safe/photo-expired.jpg',
      },
    });
    const storage = {
      deleteObject: jest.fn().mockRejectedValue(new Error('authorization=Bearer secret')),
    };
    const issueWriter = new OperationIssueWriterService(firestore as never);
    const retention = new RetentionService(firestore as never, storage as never, issueWriter as never);

    await expect(retention.purgeExpiredRecords({ now })).resolves.toMatchObject({
      deletedCount: 0,
      failedCount: 1,
    });
    await retention.purgeExpiredRecords({ now });

    expect(storage.deleteObject).toHaveBeenCalledTimes(6);
    expect(records.has('deliveryPhotoRecords/photo-expired')).toBe(true);

    const issues = operationIssues(records);
    expect(issues).toHaveLength(1);
    expect(issues[0][1]).toMatchObject({
      type: 'RETENTION_DELETE_FAILED',
      storeId: 'store-safe',
      orderId: 'order-safe',
      status: 'OPEN',
    });
    expect(JSON.stringify(issues[0][1])).not.toMatch(
      /authorization|bearer|secret|credential|phone|address/i,
    );

    const operations = new OperationsService(
      firestore as never,
      {} as never,
      {} as never,
      issueWriter as never,
    );
    const { items } = await operations.listIssuesForStore('store-safe', 'seller-1', 'seller');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'RETENTION_DELETE_FAILED',
      storeId: 'store-safe',
      status: 'OPEN',
    });
  });

  it('DELIVERY_PHOTO 보관 metadata는 non-PII storeId만 추가로 허용하고 개인정보 필드는 거부한다', async () => {
    const { firestore } = makeFirestore({});
    const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
    const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-safe' }) };
    const retention = new RetentionService(firestore as never, storage as never, issueWriter as never);

    await expect(
      retention.saveRecord({
        id: 'photo-safe',
        purpose: 'DELIVERY_PHOTO',
        basisAt: now,
        storagePath: 'deliveryPhotos/order-safe/photo-safe.jpg',
        metadata: { orderId: 'order-safe', photoId: 'photo-safe', storeId: 'store-safe' },
      }),
    ).resolves.toBeDefined();

    await expect(
      retention.saveRecord({
        id: 'photo-unsafe',
        purpose: 'DELIVERY_PHOTO',
        basisAt: now,
        metadata: {
          orderId: 'order-safe',
          photoId: 'photo-safe',
          storeId: 'store-safe',
          phone: '010-0000-0000',
        },
      }),
    ).rejects.toThrow('허용되지 않은 보관 metadata');
  });
});
