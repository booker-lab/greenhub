import { HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  AI_DAILY_LIMIT_ENV,
  AI_QUOTA_EXCEEDED_MESSAGE,
  AI_USAGE_COLLECTION,
  AiQuotaService,
  DEFAULT_AI_DAILY_LIMIT,
  kstDateKey,
} from './ai-quota.service';

type Data = Record<string, unknown>;

function makeFirestore(initial: Record<string, Data> = {}) {
  const records = new Map(Object.entries(initial));
  const doc = (path: string) => ({ path });
  const firestore = {
    collection: jest.fn((name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) })),
    runTransaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        get: async (ref: { path: string }) => ({
          exists: records.has(ref.path),
          data: () => records.get(ref.path),
        }),
        set: (ref: { path: string }, data: Data) => {
          records.set(ref.path, data);
        },
      }),
    ),
  };
  return { firestore, records };
}

function makeConfig(limit?: string) {
  return {
    get: jest.fn((key: string) => (key === AI_DAILY_LIMIT_ENV ? limit : undefined)),
  } as unknown as ConfigService;
}

// 2026-10-09 23:30 UTC = 2026-10-10 08:30 KST
const NOW = new Date('2026-10-09T23:30:00.000Z');
const PATH = `${AI_USAGE_COLLECTION}/seller-1_2026-10-10`;

describe('AiQuotaService', () => {
  it('KST 날짜로 사용자별 카운터 문서를 만든다', async () => {
    const { firestore, records } = makeFirestore();
    const service = new AiQuotaService(firestore as never, makeConfig());

    await expect(service.consume('seller-1', NOW)).resolves.toBe(1);

    expect(kstDateKey(NOW)).toBe('2026-10-10');
    expect(records.get(PATH)).toEqual({
      uid: 'seller-1',
      date: '2026-10-10',
      count: 1,
      updatedAt: NOW.toISOString(),
    });
  });

  it('한도 미만이면 카운터를 하나 올린다', async () => {
    const { firestore, records } = makeFirestore({ [PATH]: { count: 2 } });
    const service = new AiQuotaService(firestore as never, makeConfig('3'));

    await expect(service.consume('seller-1', NOW)).resolves.toBe(3);
    expect(records.get(PATH)).toMatchObject({ count: 3 });
  });

  it('한도에 도달하면 429를 반환하고 카운터를 바꾸지 않는다', async () => {
    const { firestore, records } = makeFirestore({ [PATH]: { count: 3 } });
    const service = new AiQuotaService(firestore as never, makeConfig('3'));

    const result = service.consume('seller-1', NOW);
    await expect(result).rejects.toBeInstanceOf(HttpException);
    await expect(result).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      message: AI_QUOTA_EXCEEDED_MESSAGE,
    });
    expect(records.get(PATH)).toEqual({ count: 3 });
  });

  it('설정이 없거나 잘못되면 기본 한도를 쓴다', () => {
    const { firestore } = makeFirestore();

    expect(new AiQuotaService(firestore as never, makeConfig()).dailyLimit()).toBe(
      DEFAULT_AI_DAILY_LIMIT,
    );
    expect(new AiQuotaService(firestore as never, makeConfig('0')).dailyLimit()).toBe(
      DEFAULT_AI_DAILY_LIMIT,
    );
    expect(new AiQuotaService(firestore as never, makeConfig('abc')).dailyLimit()).toBe(
      DEFAULT_AI_DAILY_LIMIT,
    );
    expect(new AiQuotaService(firestore as never, makeConfig('5')).dailyLimit()).toBe(5);
  });
});
