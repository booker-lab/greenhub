import { SettlementsService } from './settlements.service';

function makeService(records: Array<Record<string, unknown>> = []) {
  const calls: unknown[][] = [];
  const query = {} as {
    where: jest.Mock;
    orderBy: jest.Mock;
    get: jest.Mock;
  };
  query.where = jest.fn((...args: unknown[]) => {
    calls.push(args);
    return query;
  });
  query.orderBy = jest.fn((...args: unknown[]) => {
    calls.push(args);
    return query;
  });
  query.get = jest.fn().mockImplementation(async () => ({
    docs: records
      .filter((record) =>
        calls.every(([field, operator, expected]) => {
          if (field !== 'settledAt' || (operator !== '>=' && operator !== '<')) return true;
          const actual = record['settledAt'];
          if (!(actual instanceof Date) || !(expected instanceof Date)) return false;
          if (operator === '>=') return actual.getTime() >= expected.getTime();
          if (operator === '<') return actual.getTime() < expected.getTime();
          return true;
        }),
      )
      .map((record) => ({ data: () => record })),
  }));

  const firestore = {
    collection: jest.fn().mockReturnValue(query),
    doc: jest.fn(),
    Timestamp: {
      fromDate: jest.fn((date: Date) => date),
      now: jest.fn(() => new Date('2026-08-25T00:00:00.000Z')),
    },
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  return { calls, service: new SettlementsService(firestore as never, config as never) };
}

describe('SettlementsService KST 날짜 범위', () => {
  it('동일한 from/to는 KST 하루의 start inclusive와 endExclusive를 사용한다', async () => {
    const { calls, service } = makeService();

    await service.getSettlements('store-1', 'admin-1', 'admin', {
      from: '2026-08-24',
      to: '2026-08-24',
    });

    expect(calls).toContainEqual([
      'settledAt',
      '>=',
      new Date('2026-08-23T15:00:00.000Z'),
    ]);
    expect(calls).toContainEqual([
      'settledAt',
      '<',
      new Date('2026-08-24T15:00:00.000Z'),
    ]);
  });

  it('여러 날 범위는 from 날짜 시작부터 to 다음 날 시작 직전까지 포함한다', async () => {
    const { calls, service } = makeService();

    await service.getSettlements('store-1', 'admin-1', 'admin', {
      from: '2026-08-24',
      to: '2026-08-26',
    });

    expect(calls).toContainEqual([
      'settledAt',
      '>=',
      new Date('2026-08-23T15:00:00.000Z'),
    ]);
    expect(calls).toContainEqual([
      'settledAt',
      '<',
      new Date('2026-08-26T15:00:00.000Z'),
    ]);
  });

  it('endExclusive 직전 레코드는 포함하고 정확히 위치한 레코드는 제외한다', async () => {
    const { service } = makeService([
      { id: 'before-end', settledAt: new Date('2026-08-24T14:59:59.999Z') },
      { id: 'at-end', settledAt: new Date('2026-08-24T15:00:00.000Z') },
    ]);

    const result = await service.getSettlements('store-1', 'admin-1', 'admin', {
      from: '2026-08-24',
      to: '2026-08-24',
    });

    expect(result.settlements.map((settlement: Record<string, unknown>) => settlement['id'])).toEqual([
      'before-end',
    ]);
  });

  it('summary 기본 날짜도 KST business date를 사용한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T15:30:00.000Z'));

    try {
      const { calls, service } = makeService();
      const result = await service.getSummary('store-1', 'admin-1', 'admin', {});

      expect(result.date).toBe('2026-08-25');
      expect(calls).toContainEqual([
        'settledAt',
        '>=',
        new Date('2026-08-24T15:00:00.000Z'),
      ]);
      expect(calls).toContainEqual([
        'settledAt',
        '<',
        new Date('2026-08-25T15:00:00.000Z'),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
