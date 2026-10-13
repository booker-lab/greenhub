import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { SettlementsController } from './settlements.controller';
import {
  resolveSettlementListLimit,
  SETTLEMENT_LIST_DEFAULT_LIMIT,
  SETTLEMENT_LIST_MAX_LIMIT,
  SettlementsService,
} from './settlements.service';

type Data = Record<string, unknown>;
type Actor = 'admin' | 'seller' | 'otherSeller' | 'consumer' | 'driver';

const JWT_SECRET = 'settlements-controller-test-secret';

const ACTORS: Record<Actor, { sub: string; role: string; storeId: string | null }> = {
  admin: { sub: 'admin-1', role: 'admin', storeId: null },
  seller: { sub: 'seller-1', role: 'seller', storeId: 'store-1' },
  otherSeller: { sub: 'seller-2', role: 'seller', storeId: 'store-2' },
  consumer: { sub: 'consumer-1', role: 'consumer', storeId: null },
  driver: { sub: 'driver-1', role: 'driver', storeId: null },
};

function settlement(id: string, storeId: string, settledAt: string, status = 'pending'): Data {
  return { id, orderId: id, storeId, status, totalAmount: 10000, settledAt: new Date(settledAt) };
}

// settledAt 최신순, 같으면 문서 id 역순(Firestore가 마지막 정렬 방향으로 붙이는 __name__ 정렬과 같다).
function compareDesc(a: Data, b: Data): number {
  const diff = (b.settledAt as Date).getTime() - (a.settledAt as Date).getTime();
  if (diff !== 0) return diff;
  return String(b.id).localeCompare(String(a.id));
}

function makeHarness() {
  const users = new Map<string, Data>(
    Object.values(ACTORS).map((actor) => [
      actor.sub,
      { role: actor.role, storeId: actor.storeId, driverApproved: actor.role === 'driver' },
    ]),
  );
  const stores = new Map<string, Data>([
    ['store-1', { ownerId: 'seller-1' }],
    ['store-2', { ownerId: 'seller-2' }],
  ]);
  const settlements = new Map<string, Data>(
    [
      settlement('s-1', 'store-1', '2026-10-01T00:00:00.000Z'),
      settlement('s-2', 'store-1', '2026-10-02T00:00:00.000Z', 'confirmed'),
      // 같은 시각 두 건 — 페이지 경계에서 빠지거나 겹치지 않아야 한다.
      settlement('s-3', 'store-1', '2026-10-03T00:00:00.000Z'),
      settlement('s-4', 'store-1', '2026-10-03T00:00:00.000Z'),
      settlement('s-5', 'store-1', '2026-10-04T00:00:00.000Z', 'paid'),
      settlement('s-6', 'store-1', '2026-10-05T00:00:00.000Z'),
      settlement('other-1', 'store-2', '2026-10-06T00:00:00.000Z'),
    ].map((row) => [row.id as string, row]),
  );

  const reads = {
    docPaths: [] as string[],
    listQueries: 0,
    limits: [] as number[],
    startAfterIds: [] as string[],
  };

  const sources: Record<string, Map<string, Data>> = { users, stores, settlements };

  function snapshot(id: string, data: Data | undefined) {
    return { id, exists: data !== undefined, data: () => data };
  }

  function makeQuery(collection: string) {
    expect(collection).toBe('settlements');
    const filters: Array<[string, string, unknown]> = [];
    let after: Data | null = null;
    let max = Number.POSITIVE_INFINITY;
    const query = {
      where(field: string, op: string, value: unknown) {
        filters.push([field, op, value]);
        return query;
      },
      orderBy(field: string, direction: string) {
        expect([field, direction]).toEqual(['settledAt', 'desc']);
        return query;
      },
      startAfter(cursor: { id: string; data: () => Data }) {
        reads.startAfterIds.push(cursor.id);
        after = cursor.data();
        return query;
      },
      limit(n: number) {
        reads.limits.push(n);
        max = n;
        return query;
      },
      async get() {
        reads.listQueries += 1;
        const rows = [...settlements.values()]
          .filter((row) =>
            filters.every(([field, op, value]) => {
              const actual = row[field];
              if (op === '==') return actual === value;
              if (op === '>=') return (actual as Date) >= (value as Date);
              if (op === '<') return (actual as Date) < (value as Date);
              throw new Error(`unexpected operator ${op}`);
            }),
          )
          .sort(compareDesc)
          .filter((row) => after === null || compareDesc(after, row) < 0)
          .slice(0, max);
        return { docs: rows.map((row) => snapshot(row.id as string, row)) };
      },
    };
    return query;
  }

  const firestore = {
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => {
        reads.docPaths.push(path);
        const [collection, id, ...rest] = path.split('/');
        if (rest.length > 0) throw new Error(`document path expected: ${path}`);
        return snapshot(id, sources[collection]?.get(id));
      }),
    })),
    collection: jest.fn((name: string) => makeQuery(name)),
    Timestamp: { fromDate: (date: Date) => date, now: () => new Date() },
  };

  return { firestore, reads };
}

describe('SettlementsController', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(async () => {
    harness = makeHarness();
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [SettlementsController],
      providers: [
        SettlementsService,
        { provide: FirestoreService, useValue: harness.firestore },
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET }) },
        JwtAuthGuard,
        RolesGuard,
        JwtStrategy,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    jwt = app.get(JwtService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function get(path: string, actor?: Actor) {
    const test = request(app.getHttpServer()).get(path);
    if (!actor) return test;
    const { sub, role, storeId } = ACTORS[actor];
    return test.set('Authorization', `Bearer ${jwt.sign({ sub, role, storeId })}`);
  }

  async function listIds(path: string, actor: Actor = 'seller') {
    const res = await get(path, actor).expect(200);
    return {
      body: res.body as {
        settlements: Data[];
        total: number;
        hasMore: boolean;
        nextCursor: string | null;
      },
      ids: (res.body.settlements as Data[]).map((row) => row.id),
    };
  }

  describe('권한', () => {
    it('모든 정산 경로는 인증 후 판매자 또는 관리자 역할만 통과한다', () => {
      expect(Reflect.getMetadata(ROLES_KEY, SettlementsController)).toEqual(['seller', 'admin']);
      expect(Reflect.getMetadata(GUARDS_METADATA, SettlementsController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    });

    it.each([
      '/stores/store-1/settlements',
      '/stores/store-1/settlements/summary',
    ])('%s — 토큰이 없으면 401', async (path) => {
      await get(path).expect(401);
      expect(harness.firestore.collection).not.toHaveBeenCalled();
    });

    it.each([
      ['/stores/store-1/settlements', 'consumer'],
      ['/stores/store-1/settlements', 'driver'],
      ['/stores/store-1/settlements/summary', 'consumer'],
      ['/stores/store-1/settlements/summary', 'driver'],
    ] as const)('%s — %s 역할은 매장 조회 전에 403', async (path, actor) => {
      await get(path, actor).expect(403);
      expect(harness.reads.docPaths).not.toContain('stores/store-1');
      expect(harness.firestore.collection).not.toHaveBeenCalled();
    });

    it.each([
      '/stores/store-1/settlements',
      '/stores/store-1/settlements/summary',
    ])('%s — 다른 매장 판매자는 소유 확인에서 403', async (path) => {
      await get(path, 'otherSeller').expect(403);
      expect(harness.reads.docPaths).toContain('stores/store-1');
      expect(harness.firestore.collection).not.toHaveBeenCalled();
    });

    it('매장 주인 판매자는 자기 매장 정산을, 관리자는 어느 매장 정산이든 읽는다', async () => {
      expect((await listIds('/stores/store-1/settlements', 'seller')).ids).toEqual([
        's-6',
        's-5',
        's-4',
        's-3',
        's-2',
        's-1',
      ]);
      expect((await listIds('/stores/store-2/settlements', 'admin')).ids).toEqual(['other-1']);
      await get('/stores/store-1/settlements/summary?date=2026-10-03', 'seller').expect(200);
    });
  });

  describe('목록 limit', () => {
    it('limit 없이 부르면 기존 응답 모양에 hasMore·nextCursor만 더해 기본 건수까지 돌려준다', async () => {
      const { body } = await listIds('/stores/store-1/settlements');

      expect(Array.isArray(body.settlements)).toBe(true);
      expect(body).toMatchObject({ total: 6, hasMore: false, nextCursor: null });
      expect(harness.reads.limits).toEqual([SETTLEMENT_LIST_DEFAULT_LIMIT + 1]);
    });

    it('상한보다 큰 limit은 상한으로 줄인다', async () => {
      await listIds('/stores/store-1/settlements?limit=100000');
      expect(harness.reads.limits).toEqual([SETTLEMENT_LIST_MAX_LIMIT + 1]);
    });

    it.each(['0', '-1', '1.5', 'abc'])('limit=%s는 조회 없이 400', async (limit) => {
      await get(`/stores/store-1/settlements?limit=${limit}`, 'seller').expect(400);
      expect(harness.firestore.collection).not.toHaveBeenCalled();
    });

    it.each([
      [undefined, SETTLEMENT_LIST_DEFAULT_LIMIT],
      [null, SETTLEMENT_LIST_DEFAULT_LIMIT],
      ['', SETTLEMENT_LIST_DEFAULT_LIMIT],
      [Number.NaN, SETTLEMENT_LIST_DEFAULT_LIMIT],
      ['20', 20],
      [20, 20],
      [2.7, 2],
      [0, 1],
      [-5, 1],
      [SETTLEMENT_LIST_MAX_LIMIT + 1, SETTLEMENT_LIST_MAX_LIMIT],
    ])('resolveSettlementListLimit(%p) = %p', (raw, expected) => {
      expect(resolveSettlementListLimit(raw)).toBe(expected);
    });
  });

  describe('목록 cursor', () => {
    it('nextCursor로 이어 받으면 같은 시각 정산도 빠짐·겹침 없이 끝까지 받는다', async () => {
      const pages: unknown[][] = [];
      let cursor: string | null = null;
      do {
        const query = cursor ? `limit=2&cursor=${cursor}` : 'limit=2';
        const { body, ids } = await listIds(`/stores/store-1/settlements?${query}`);
        pages.push(ids);
        expect(body.total).toBe(ids.length);
        expect(body.nextCursor).toBe(body.hasMore ? ids[ids.length - 1] : null);
        cursor = body.nextCursor;
      } while (cursor && pages.length < 10);

      expect(pages).toEqual([
        ['s-6', 's-5'],
        ['s-4', 's-3'],
        ['s-2', 's-1'],
      ]);
      expect(harness.reads.startAfterIds).toEqual(['s-5', 's-3']);
      expect(harness.reads.limits).toEqual([3, 3, 3]);
    });

    it('status 필터와 함께 이어 받아도 필터가 유지된다', async () => {
      const first = await listIds('/stores/store-1/settlements?status=pending&limit=1');
      expect(first.ids).toEqual(['s-6']);
      expect(first.body.hasMore).toBe(true);

      const second = await listIds(
        `/stores/store-1/settlements?status=pending&limit=5&cursor=${first.body.nextCursor}`,
      );
      expect(second.ids).toEqual(['s-4', 's-3', 's-1']);
      expect(second.body).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it.each([
      ['다른 매장 정산', 'other-1'],
      ['없는 정산', 'missing-1'],
    ])('%s을 cursor로 주면 목록 조회 없이 400', async (_label, cursor) => {
      await get(`/stores/store-1/settlements?cursor=${cursor}`, 'seller').expect(400);
      expect(harness.reads.docPaths).toContain(`settlements/${cursor}`);
      expect(harness.reads.listQueries).toBe(0);
    });

    it.each([
      'a%2Fb',
      '..%2Fstores%2Fstore-1',
      'x'.repeat(129),
    ])('형식이 틀린 cursor(%s)는 문서를 읽지 않고 400', async (cursor) => {
      await get(`/stores/store-1/settlements?cursor=${cursor}`, 'seller').expect(400);
      expect(harness.reads.docPaths.filter((path) => path.startsWith('settlements/'))).toEqual([]);
      expect(harness.firestore.collection).not.toHaveBeenCalled();
    });
  });
});
