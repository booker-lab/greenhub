type Data = Record<string, unknown>;

type RetentionPurpose = 'DELIVERY_PHOTO' | 'MARKETING_CONSENT' | 'LEGAL_ORDER' | 'LEGAL_DISPUTE';

interface RetentionServiceContract {
  saveRecord(input: {
    id: string;
    purpose: RetentionPurpose;
    basisAt: Date;
    storagePath?: string;
    metadata?: Data;
  }): Promise<Data>;
  purgeExpiredRecords(input: { now: Date }): Promise<Data>;
}

type RetentionServiceConstructor = new (firestore: Data, storage: Data) => RetentionServiceContract;

function loadRetentionService(): RetentionServiceConstructor | null {
  try {
    return (
      (
        require('./retention.service') as {
          RetentionService?: RetentionServiceConstructor;
        }
      ).RetentionService ?? null
    );
  } catch {
    return null;
  }
}

function timestamp(iso: string) {
  const date = new Date(iso);
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
  };
}

function makeService(initial: Record<string, Data> = {}) {
  const RetentionService = loadRetentionService();
  if (!RetentionService) {
    throw new Error('Task 3.10의 RetentionService 구현이 아직 없습니다.');
  }

  const records = new Map<string, Data>(Object.entries(initial));
  const writes: Array<{ path: string; data: Data }> = [];
  const deletes: string[] = [];
  const commits: string[][] = [];
  const queries: Array<{ collection: string; field: string; op: string; value: unknown }> = [];

  const doc = (path: string) => ({
    path,
    set: jest.fn(async (data: Data) => {
      writes.push({ path, data });
      records.set(path, data);
    }),
  });
  const collection = (name: string) => {
    const filters: Array<[string, string, unknown]> = [];
    const query = {
      where(field: string, op: string, value: unknown) {
        filters.push([field, op, value]);
        queries.push({ collection: name, field, op, value });
        return query;
      },
      async get() {
        const docs = Array.from(records.entries())
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, data]) => ({
            id: path.split('/')[1],
            data: () => data,
            ref: { path },
          }))
          .filter((snapshot) =>
            filters.every(([field, op, value]) => {
              const actual = snapshot.data()[field] as { toMillis?: () => number } | undefined;
              const expected = value as { toMillis?: () => number };
              if (op === '<=') {
                return (
                  (actual?.toMillis?.() ?? Number.POSITIVE_INFINITY) <=
                  (expected?.toMillis?.() ?? Number.NEGATIVE_INFINITY)
                );
              }
              return actual === value;
            }),
          );
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
    return query;
  };
  const batches: Data[] = [];
  const createBatch = () => {
    const pendingDeletes: string[] = [];
    const batch = {
      delete: jest.fn((ref: { path: string }) => {
        pendingDeletes.push(ref.path);
        deletes.push(ref.path);
        return batch;
      }),
      commit: jest.fn(async () => {
        commits.push([...pendingDeletes]);
        for (const path of pendingDeletes) records.delete(path);
      }),
    };
    batches.push(batch);
    return batch;
  };
  const firestore = {
    doc,
    collection,
    batch: jest.fn(createBatch),
    Timestamp: {
      now: jest.fn(() => timestamp('2026-07-17T01:00:00.000Z')),
      fromDate: jest.fn((date: Date) => timestamp(date.toISOString())),
    },
  };
  const storage = {
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const issueWriter = {
    createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-safe' }),
  };
  const service = new RetentionService(firestore, storage, issueWriter);

  return {
    batches,
    commits,
    deletes,
    firestore,
    issueWriter,
    queries,
    records,
    service,
    storage,
    writes,
  };
}

describe('보관 기간과 파기 계약', () => {
  const now = new Date('2026-07-17T01:00:00.000Z');

  it('배송 사진은 배송 완료 기준 90일 뒤 파기 예정으로 분리 저장한다', async () => {
    const { service, writes } = makeService();

    await service.saveRecord({
      id: 'photo-record-1',
      purpose: 'DELIVERY_PHOTO',
      basisAt: new Date('2026-04-18T01:00:00.000Z'),
      storagePath: 'deliveryPhotos/order-safe/photo-safe.jpg',
      metadata: { orderId: 'order-safe', photoId: 'photo-safe' },
    });

    expect(writes).toEqual([
      expect.objectContaining({
        path: 'deliveryPhotoRecords/photo-record-1',
        data: expect.objectContaining({
          purpose: 'DELIVERY_PHOTO',
          expiresAt: expect.objectContaining({
            toMillis: expect.any(Function),
          }),
        }),
      }),
    ]);
    expect((writes[0].data['expiresAt'] as { toDate: () => Date }).toDate().toISOString()).toBe(
      '2026-07-17T01:00:00.000Z',
    );
  });

  it('마케팅 동의 기록은 철회 기준 3년 뒤 파기 예정으로 별도 저장한다', async () => {
    const { service, writes } = makeService();

    await service.saveRecord({
      id: 'consent-record-1',
      purpose: 'MARKETING_CONSENT',
      basisAt: new Date('2023-07-17T01:00:00.000Z'),
      metadata: { policyVersion: 'marketing-v1', channels: ['sms'] },
    });

    expect(writes[0].path).toBe('marketingConsentLogs/consent-record-1');
    expect((writes[0].data['expiresAt'] as { toDate: () => Date }).toDate().toISOString()).toBe(
      '2026-07-17T01:00:00.000Z',
    );
  });

  it('목적별 허용 metadata만 저장하고 개인정보·비밀값 필드는 거부한다', async () => {
    const { service, writes } = makeService();

    await expect(
      service.saveRecord({
        id: 'consent-unsafe',
        purpose: 'MARKETING_CONSENT',
        basisAt: now,
        metadata: {
          orderId: 'order-safe',
          policyVersion: 'marketing-v1',
          channels: ['sms'],
          phone: '010-0000-0000',
          authorization: 'Bearer secret',
        },
      }),
    ).rejects.toThrow('허용되지 않은 보관 metadata');
    expect(writes).toHaveLength(0);
  });

  it('허용 metadata도 목적이 다르면 저장하지 않는다', async () => {
    const { service, writes } = makeService();

    await expect(
      service.saveRecord({
        id: 'legal-order-wrong-field',
        purpose: 'LEGAL_ORDER',
        basisAt: now,
        metadata: {
          orderId: 'order-safe',
          channels: ['sms'],
        },
      }),
    ).rejects.toThrow('허용되지 않은 보관 metadata');
    expect(writes).toHaveLength(0);
  });

  it('계약·결제·공급 기록은 발생 기준 5년 뒤 파기 예정으로 별도 저장한다', async () => {
    const { service, writes } = makeService();

    await service.saveRecord({
      id: 'legal-order-record-1',
      purpose: 'LEGAL_ORDER',
      basisAt: new Date('2021-07-17T01:00:00.000Z'),
      metadata: { orderId: 'order-safe', recordTypes: ['CONTRACT', 'PAYMENT', 'SUPPLY'] },
    });

    expect(writes[0].path).toBe('legalOrderRecords/legal-order-record-1');
    expect((writes[0].data['expiresAt'] as { toDate: () => Date }).toDate().toISOString()).toBe(
      '2026-07-17T01:00:00.000Z',
    );
  });

  it('환불·분쟁·고객응대 기록은 발생 기준 3년 뒤 파기 예정으로 별도 저장한다', async () => {
    const { service, writes } = makeService();

    await service.saveRecord({
      id: 'legal-dispute-record-1',
      purpose: 'LEGAL_DISPUTE',
      basisAt: new Date('2023-07-17T01:00:00.000Z'),
      metadata: { orderId: 'order-safe', recordTypes: ['REFUND', 'DISPUTE', 'SUPPORT'] },
    });

    expect(writes[0].path).toBe('legalDisputeRecords/legal-dispute-record-1');
    expect((writes[0].data['expiresAt'] as { toDate: () => Date }).toDate().toISOString()).toBe(
      '2026-07-17T01:00:00.000Z',
    );
  });

  it('분쟁 진행 또는 법적 보존 사유가 있으면 일반 만료일이 지나도 파기하지 않는다', async () => {
    const { deletes, service, storage } = makeService({
      'deliveryPhotoRecords/photo-held': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
        disputeStatus: 'OPEN',
        storagePath: 'deliveryPhotos/order-safe/photo-held.jpg',
      },
      'legalOrderRecords/order-held': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
        legalHold: true,
      },
    });

    await service.purgeExpiredRecords({ now });

    expect(deletes).not.toEqual(
      expect.arrayContaining(['deliveryPhotoRecords/photo-held', 'legalOrderRecords/order-held']),
    );
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('아직 만료되지 않은 기록은 파기하지 않고 목적별 쿼리를 하나로 합치지 않는다', async () => {
    const { deletes, queries, service } = makeService({
      'deliveryPhotoRecords/photo-future': {
        expiresAt: timestamp('2026-07-18T01:00:00.000Z'),
        disputeStatus: 'NONE',
      },
      'marketingConsentLogs/consent-future': {
        expiresAt: timestamp('2026-07-18T01:00:00.000Z'),
      },
      'legalOrderRecords/order-future': {
        expiresAt: timestamp('2026-07-18T01:00:00.000Z'),
      },
      'legalDisputeRecords/dispute-future': {
        expiresAt: timestamp('2026-07-18T01:00:00.000Z'),
        disputeStatus: 'RESOLVED',
      },
    });

    await service.purgeExpiredRecords({ now });

    expect(deletes).toHaveLength(0);
    expect(queries.map(({ collection }) => collection)).toEqual(
      expect.arrayContaining([
        'deliveryPhotoRecords',
        'marketingConsentLogs',
        'legalOrderRecords',
        'legalDisputeRecords',
      ]),
    );
    expect(new Set(queries.map(({ collection }) => collection))).toHaveProperty('size', 4);
  });

  it('만료 기록과 연결 사진을 모의 삭제하고 같은 작업 재실행은 부작용을 반복하지 않는다', async () => {
    const { batches, deletes, service, storage } = makeService({
      'deliveryPhotoRecords/photo-expired': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
        disputeStatus: 'RESOLVED',
        storagePath: 'deliveryPhotos/order-safe/photo-expired.jpg',
      },
      'marketingConsentLogs/consent-expired': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
      },
      'legalOrderRecords/order-expired': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
        legalHold: false,
      },
      'legalDisputeRecords/dispute-expired': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
        disputeStatus: 'RESOLVED',
        legalHold: false,
      },
    });

    await service.purgeExpiredRecords({ now });
    await service.purgeExpiredRecords({ now });

    expect(new Set(deletes)).toEqual(
      new Set([
        'deliveryPhotoRecords/photo-expired',
        'marketingConsentLogs/consent-expired',
        'legalOrderRecords/order-expired',
        'legalDisputeRecords/dispute-expired',
      ]),
    );
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'deliveryPhotos/order-safe/photo-expired.jpg',
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].commit).toHaveBeenCalledTimes(1);
  });

  it('만료 기록이 500건을 초과하면 Firestore 제한 이하의 여러 배치로 파기한다', async () => {
    const initial = Object.fromEntries(
      Array.from({ length: 1001 }, (_, index) => [
        `legalOrderRecords/order-${index}`,
        {
          expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
          legalHold: false,
        },
      ]),
    );
    const { commits, records, service } = makeService(initial);

    await expect(service.purgeExpiredRecords({ now })).resolves.toMatchObject({
      deletedCount: 1001,
    });

    expect(commits.length).toBeGreaterThan(2);
    expect(commits.every((paths) => paths.length <= 450)).toBe(true);
    expect(records.size).toBe(0);
  });

  it('정기 파기는 현재 시각 기준 만료 항목만 처리하고 재실행할 수 있다', async () => {
    const { records, service } = makeService({
      'legalOrderRecords/order-expired': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
      },
      'legalOrderRecords/order-future': {
        expiresAt: timestamp('2026-07-18T01:00:00.000Z'),
      },
    });

    await service.runScheduledPurge();
    await service.runScheduledPurge();

    expect(records.has('legalOrderRecords/order-expired')).toBe(false);
    expect(records.has('legalOrderRecords/order-future')).toBe(true);
  });

  it('Storage 삭제 최종 실패는 안전한 운영 예외로 남기고 보관 문서는 유지한다', async () => {
    const { issueWriter, records, service, storage } = makeService({
      'deliveryPhotoRecords/photo-failed': {
        expiresAt: timestamp('2026-07-16T01:00:00.000Z'),
        storagePath: 'deliveryPhotos/order-safe/photo-safe.jpg',
        orderId: 'order-safe',
      },
    });
    storage.deleteObject.mockRejectedValue(new Error('authorization=Bearer secret'));

    await expect(service.purgeExpiredRecords({ now })).resolves.toMatchObject({
      deletedCount: 0,
      failedCount: 1,
    });

    expect(storage.deleteObject).toHaveBeenCalledTimes(3);
    expect(records.has('deliveryPhotoRecords/photo-failed')).toBe(true);
    expect(issueWriter.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RETENTION_DELETE_FAILED',
        idempotencyKey:
          'retention-delete-failed:deliveryPhotoRecords:deliveryPhotos/order-safe/photo-safe.jpg',
      }),
    );
    expect(JSON.stringify(issueWriter.createOrMergeIssue.mock.calls[0][0])).not.toMatch(
      /authorization|bearer|secret/i,
    );
  });

  it('저장 fixture와 파기 결과에 개인정보 본문이나 비밀값을 포함하지 않는다', async () => {
    const { service, writes } = makeService();

    const result = await service.saveRecord({
      id: 'consent-safe',
      purpose: 'MARKETING_CONSENT',
      basisAt: now,
      metadata: { policyVersion: 'marketing-v1', channels: ['alimtalk', 'sms'] },
    });

    expect(JSON.stringify({ result, writes })).not.toMatch(
      /authorization|bearer|token|secret|phone|address|messageBody|messageText/i,
    );
  });
});
