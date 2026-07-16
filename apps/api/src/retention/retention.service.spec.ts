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
  const batch = {
    delete: jest.fn((ref: { path: string }) => {
      deletes.push(ref.path);
      return batch;
    }),
    commit: jest.fn(async () => {
      for (const path of deletes) records.delete(path);
    }),
  };
  const firestore = {
    doc,
    collection,
    batch: jest.fn(() => batch),
    Timestamp: {
      fromDate: jest.fn((date: Date) => timestamp(date.toISOString())),
    },
  };
  const storage = {
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RetentionService(firestore, storage);

  return { batch, deletes, firestore, queries, records, service, storage, writes };
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
    const { batch, deletes, service, storage } = makeService({
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
    expect(batch.commit).toHaveBeenCalledTimes(1);
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
