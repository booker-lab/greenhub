import {
  acquireJobLease,
  completeJobLease,
  type JobLeaseFirestore,
  seoulDailySlotKey,
} from './job-lease';

type Data = Record<string, unknown>;

/**
 * 낙관적 동시성 제어를 흉내 내는 Firestore 대역. 트랜잭션은 읽은 문서의 버전을 기억하고, 커밋할 때
 * 그 사이 다른 트랜잭션이 같은 문서를 바꿨으면 처음부터 다시 실행한다(실제 Firestore와 같은 방식).
 * 읽기 직후 다른 작업에 차례를 넘겨 두 실행이 같은 상태를 동시에 읽는 상황을 만든다.
 */
function createOccFirestore(initial: Record<string, Data> = {}) {
  const records = new Map<string, { data: Data; version: number }>(
    Object.entries(initial).map(([path, data]) => [path, { data: { ...data }, version: 1 }]),
  );
  let attempts = 0;
  let conflicts = 0;

  const firestore = {
    doc: (path: string) => ({ path }),
    runTransaction: async <T>(callback: (transaction: any) => Promise<T>): Promise<T> => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        attempts += 1;
        const reads = new Map<string, number>();
        const writes: Array<{ path: string; data: Data; merge: boolean }> = [];
        const transaction = {
          get: async (ref: { path: string }) => {
            const current = records.get(ref.path);
            reads.set(ref.path, current?.version ?? 0);
            await new Promise((resolve) => setImmediate(resolve));
            return {
              exists: current !== undefined,
              data: () => (current ? { ...current.data } : undefined),
            };
          },
          set: (ref: { path: string }, data: Data, options?: { merge?: boolean }) => {
            writes.push({ path: ref.path, data, merge: options?.merge === true });
          },
        };
        const result = await callback(transaction);
        const stale = [...reads].some(
          ([path, version]) => (records.get(path)?.version ?? 0) !== version,
        );
        if (stale) {
          conflicts += 1;
          continue;
        }
        for (const write of writes) {
          const current = records.get(write.path);
          records.set(write.path, {
            data: write.merge && current ? { ...current.data, ...write.data } : { ...write.data },
            version: (current?.version ?? 0) + 1,
          });
        }
        return result;
      }
      throw new Error('ABORTED: too much contention');
    },
  };

  return {
    firestore: firestore as unknown as JobLeaseFirestore,
    read: (path: string) => records.get(path)?.data,
    stats: () => ({ attempts, conflicts }),
  };
}

function silentLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

const JOB = 'test-job';
const PATH = `jobLeases/${JOB}`;
const NOW = Date.parse('2026-07-17T00:00:00.000Z');

describe('작업 회차 lease', () => {
  it('lease가 없으면 잡고 보유자·회차·만료 시각을 서버 전용 문서에 남긴다', async () => {
    const { firestore, read } = createOccFirestore();

    const result = await acquireJobLease(firestore, {
      jobName: JOB,
      slotKey: '2026-07-17',
      ttlMs: 60_000,
      now: () => NOW,
      logger: silentLogger(),
    });

    expect(result.status).toBe('ACQUIRED');
    expect(read(PATH)).toMatchObject({
      holderId: result.status === 'ACQUIRED' ? result.lease.holderId : 'missing',
      slotKey: '2026-07-17',
      expiresAt: NOW + 60_000,
    });
  });

  it('두 인스턴스가 같은 회차를 동시에 잡으면 하나만 잡고 나머지는 건너뛴다', async () => {
    const { firestore, stats } = createOccFirestore();
    const acquire = () =>
      acquireJobLease(firestore, {
        jobName: JOB,
        slotKey: '2026-07-17',
        ttlMs: 60_000,
        now: () => NOW,
        logger: silentLogger(),
      });

    const results = await Promise.all([acquire(), acquire(), acquire(), acquire(), acquire()]);

    expect(results.filter((result) => result.status === 'ACQUIRED')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'HELD')).toHaveLength(4);
    // 동시에 같은 상태를 읽었다가 커밋 충돌로 다시 실행된 경우가 실제로 있었다.
    expect(stats().conflicts).toBeGreaterThan(0);
  });

  it('완료로 기록한 회차는 다시 잡지 않고, 다음 회차는 잡는다', async () => {
    const { firestore, read } = createOccFirestore();
    const logger = silentLogger();
    const first = await acquireJobLease(firestore, {
      jobName: JOB,
      slotKey: '2026-07-17',
      ttlMs: 60_000,
      now: () => NOW,
      logger,
    });
    if (first.status !== 'ACQUIRED') throw new Error('lease를 잡지 못했습니다.');

    await expect(
      completeJobLease(firestore, first.lease, { succeeded: true, now: () => NOW, logger }),
    ).resolves.toBe(true);
    expect(read(PATH)).toMatchObject({
      holderId: null,
      expiresAt: null,
      lastCompletedSlot: '2026-07-17',
    });

    // lease가 풀려 있어도 같은 회차는 이미 끝났으므로 건너뛴다(늦게 뜬 인스턴스·재시작).
    await expect(
      acquireJobLease(firestore, {
        jobName: JOB,
        slotKey: '2026-07-17',
        ttlMs: 60_000,
        now: () => NOW + 120_000,
        logger,
      }),
    ).resolves.toEqual({ status: 'ALREADY_DONE' });
    await expect(
      acquireJobLease(firestore, {
        jobName: JOB,
        slotKey: '2026-07-18',
        ttlMs: 60_000,
        now: () => NOW + 86_400_000,
        logger,
      }),
    ).resolves.toMatchObject({ status: 'ACQUIRED' });
  });

  it('만료되지 않은 lease는 건너뛰고, 만료된 lease는 넘겨받는다', async () => {
    const { firestore } = createOccFirestore({
      [PATH]: { holderId: 'crashed-holder', slotKey: '2026-07-17', expiresAt: NOW + 1_000 },
    });
    const acquireAt = (at: number) =>
      acquireJobLease(firestore, {
        jobName: JOB,
        slotKey: '2026-07-17',
        ttlMs: 60_000,
        now: () => at,
        logger: silentLogger(),
      });

    await expect(acquireAt(NOW)).resolves.toEqual({ status: 'HELD' });
    await expect(acquireAt(NOW + 1_000)).resolves.toMatchObject({ status: 'ACQUIRED' });
  });

  it('실패로 끝난 회차는 완료로 남기지 않고 lease만 풀어 다시 잡을 수 있게 한다', async () => {
    const { firestore, read } = createOccFirestore();
    const logger = silentLogger();
    const first = await acquireJobLease(firestore, {
      jobName: JOB,
      slotKey: '2026-07-17',
      ttlMs: 60_000,
      now: () => NOW,
      logger,
    });
    if (first.status !== 'ACQUIRED') throw new Error('lease를 잡지 못했습니다.');

    await completeJobLease(firestore, first.lease, { succeeded: false, logger });

    expect(read(PATH)).toMatchObject({ holderId: null, expiresAt: null });
    expect(read(PATH)?.['lastCompletedSlot']).toBeUndefined();
    await expect(
      acquireJobLease(firestore, {
        jobName: JOB,
        slotKey: '2026-07-17',
        ttlMs: 60_000,
        now: () => NOW,
        logger,
      }),
    ).resolves.toMatchObject({ status: 'ACQUIRED' });
  });

  it('다른 실행에 넘어간 lease는 이전 보유자가 완료·해제하지 못한다', async () => {
    const { firestore, read } = createOccFirestore({
      [PATH]: { holderId: 'new-holder', slotKey: '2026-07-17', expiresAt: NOW + 60_000 },
    });
    const logger = silentLogger();

    await expect(
      completeJobLease(
        firestore,
        { jobName: JOB, slotKey: '2026-07-17', holderId: 'old-holder' },
        { succeeded: true, logger },
      ),
    ).resolves.toBe(false);

    expect(read(PATH)).toEqual({
      holderId: 'new-holder',
      slotKey: '2026-07-17',
      expiresAt: NOW + 60_000,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('저장소 오류는 throw하지 않고 UNAVAILABLE·false로 알린다', async () => {
    const firestore = {
      doc: (path: string) => ({ path }),
      runTransaction: jest.fn().mockRejectedValue(new Error('UNAVAILABLE: backend')),
    } as unknown as JobLeaseFirestore;
    const logger = silentLogger();

    await expect(
      acquireJobLease(firestore, {
        jobName: JOB,
        slotKey: '2026-07-17',
        ttlMs: 60_000,
        logger,
      }),
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
    await expect(
      completeJobLease(
        firestore,
        { jobName: JOB, slotKey: '2026-07-17', holderId: 'holder' },
        { succeeded: true, logger },
      ),
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('작업 이름이 경로로 쓸 수 없는 형식이면 저장소에 접근하지 않는다', async () => {
    const firestore = {
      doc: jest.fn(),
      runTransaction: jest.fn(),
    };

    await expect(
      acquireJobLease(firestore as unknown as JobLeaseFirestore, {
        jobName: 'a/b',
        slotKey: '2026-07-17',
        ttlMs: 60_000,
        logger: silentLogger(),
      }),
    ).resolves.toEqual({ status: 'UNAVAILABLE' });
    expect(firestore.doc).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('하루 회차 키는 서울 날짜를 쓴다', () => {
    expect(seoulDailySlotKey(new Date('2026-07-16T14:59:59.999Z'))).toBe('2026-07-16');
    expect(seoulDailySlotKey(new Date('2026-07-16T15:00:00.000Z'))).toBe('2026-07-17');
    expect(seoulDailySlotKey(new Date('2026-07-16T18:00:00.000Z'))).toBe('2026-07-17');
  });
});
