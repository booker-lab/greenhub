import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StoresService } from './stores.service';

const BUCKET = 'greenhub-api-unit-test.appspot.com';

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    NODE_ENV: 'test',
    FIREBASE_PROJECT_ID: 'greenhub-api-unit-test',
    FIREBASE_STORAGE_BUCKET: BUCKET,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as never;
}

function logoUrl(ownerId: string, stamp = '1760000000000') {
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(
    `logos/${ownerId}_${stamp}`,
  )}?alt=media&token=abc`;
}

function makeService(storeData: Record<string, unknown> | null) {
  const firestore = {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: storeData !== null,
        data: () => storeData,
      }),
    }),
    collection: jest.fn(),
  };
  return new StoresService(firestore as never, makeConfig());
}

describe('public store profile contract', () => {
  it('allowlist 필드만 반환한다', async () => {
    const service = makeService({
      id: 's-1',
      ownerId: 'seller-1',
      name: '디어오키드',
      ceoName: '홍길동',
      phone: '010-1234-5678',
      address: '경기도 이천시',
      businessNumber: '123-45-67890',
      logoUrl: 'https://example.com/logo.png',
      status: 'active',
      salesMode: 'round_direct',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const profile = (await service.getPublicProfile('s-1')) as Record<string, unknown>;
    expect(Object.keys(profile).sort()).toEqual(['id', 'logoUrl', 'name', 'salesMode'].sort());
    expect(profile).toEqual({
      id: 's-1',
      name: '디어오키드',
      logoUrl: 'https://example.com/logo.png',
      salesMode: 'round_direct',
    });
    expect(profile).not.toHaveProperty('ownerId');
    expect(profile).not.toHaveProperty('ceoName');
    expect(profile).not.toHaveProperty('phone');
    expect(profile).not.toHaveProperty('address');
    expect(profile).not.toHaveProperty('businessNumber');
    expect(profile).not.toHaveProperty('status');
    expect(profile).not.toHaveProperty('createdAt');
    expect(profile).not.toHaveProperty('updatedAt');
  });

  it.each([
    ['legacy'],
    [undefined],
    [null],
    ['unsupported'],
  ])('salesMode %s는 legacy로 정규화한다 (round_direct만 공개 직배송)', async (salesMode) => {
    const service = makeService({ id: 's-1', name: '상점', logoUrl: null, salesMode });
    const profile = (await service.getPublicProfile('s-1')) as Record<string, unknown>;
    if (salesMode === 'legacy' || salesMode == null) {
      expect(profile['salesMode']).toBe('legacy');
    } else {
      // invalid 값은 legacy로 fail-closed한다.
      expect(profile['salesMode']).toBe('legacy');
    }
  });

  it('존재하지 않는 store는 404한다', async () => {
    const service = makeService(null);
    await expect(service.getPublicProfile('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('owner store API regression', () => {
  it('owner 조회는 기존 계약을 유지한다', async () => {
    const service = makeService({
      ownerId: 'seller-1',
      name: '디어오키드',
      ceoName: '홍길동',
      phone: '010-1234-5678',
      address: '경기도 이천시',
      businessNumber: '123-45-67890',
      logoUrl: null,
    });

    await expect(service.getStore('s-1', 'seller-1')).resolves.toMatchObject({
      id: 's-1',
      name: '디어오키드',
    });
  });

  it('owner가 아닌 조회는 거부한다', async () => {
    const service = makeService({ ownerId: 'seller-1', name: '상점' });
    await expect(service.getStore('s-1', 'seller-2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('존재하지 않는 store는 404한다', async () => {
    const service = makeService(null);
    await expect(service.getStore('missing', 'seller-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * In-memory Firestore 대역. runTransaction은 Firestore처럼 직렬화해 실행하고,
 * 트랜잭션 안의 쓰기는 콜백이 성공했을 때만 한꺼번에 반영한다.
 */
function makeTransactionalStore(initial: Record<string, Record<string, unknown>>) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(initial));
  let queue: Promise<unknown> = Promise.resolve();
  const ref = (path: string) => ({ path });
  const firestore = {
    doc: jest.fn((path: string) => ({
      ...ref(path),
      get: jest.fn(async () => ({ exists: docs.has(path), data: () => docs.get(path) })),
      update: jest.fn(async (patch: Record<string, unknown>) => {
        docs.set(path, { ...(docs.get(path) ?? {}), ...patch });
      }),
    })),
    collection: jest.fn((name: string) => {
      const filters: Array<[string, unknown]> = [];
      const query = {
        where: (field: string, _op: string, value: unknown) => {
          filters.push([field, value]);
          return query;
        },
        limit: () => query,
        run: () =>
          [...docs.entries()].filter(
            ([path, data]) =>
              path.startsWith(`${name}/`) && filters.every(([f, v]) => data[f] === v),
          ),
      };
      return query;
    }),
    runTransaction: jest.fn(<T>(fn: (tx: unknown) => Promise<T>) => {
      const run = queue.then(async () => {
        const writes: Array<() => void> = [];
        const tx = {
          get: async (target: { path?: string; run?: () => unknown[] }) => {
            if (target.run) {
              const rows = target.run();
              return { empty: rows.length === 0, size: rows.length };
            }
            const path = target.path as string;
            return { exists: docs.has(path), data: () => docs.get(path) };
          },
          create: (target: { path: string }, data: Record<string, unknown>) => {
            if (docs.has(target.path)) throw new Error('ALREADY_EXISTS');
            writes.push(() => docs.set(target.path, data));
          },
          set: (target: { path: string }, data: Record<string, unknown>) => {
            writes.push(() => docs.set(target.path, data));
          },
          update: (target: { path: string }, patch: Record<string, unknown>) => {
            writes.push(() =>
              docs.set(target.path, { ...(docs.get(target.path) ?? {}), ...patch }),
            );
          },
        };
        const result = await fn(tx);
        for (const write of writes) write();
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    }),
    Timestamp: { now: () => 'now' },
    FieldValue: { serverTimestamp: () => 'server-now' },
  };
  return { docs, service: new StoresService(firestore as never, makeConfig()) };
}

describe('store creation', () => {
  it('판매자 온보딩은 매장·users.storeId·배송비 설정을 함께 만든다', async () => {
    const { docs, service } = makeTransactionalStore({
      'users/seller-1': { id: 'seller-1', role: 'seller', storeId: null },
    });

    const { storeId } = await service.createStore('seller-1', {
      name: '디어오키드',
      ceoName: '홍길동',
      phone: '010-1234-5678',
      address: '경기도 이천시',
      logoUrl: logoUrl('seller-1'),
    });

    expect(docs.get(`stores/${storeId}`)).toMatchObject({
      id: storeId,
      ownerId: 'seller-1',
      name: '디어오키드',
      status: 'active',
      logoUrl: logoUrl('seller-1'),
    });
    expect(docs.get('users/seller-1')).toMatchObject({ storeId });
    expect(docs.get(`deliveryFeeConfig/${storeId}`)).toMatchObject({ storeId, directFee: 3000 });
  });

  it.each([
    ['consumer'],
    ['driver'],
    ['admin'],
    [undefined],
  ])('%s 역할 계정은 매장을 만들 수 없다', async (role) => {
    const { docs, service } = makeTransactionalStore({
      'users/user-1': { id: 'user-1', role, storeId: null },
    });

    await expect(service.createStore('user-1', { name: '상점' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect([...docs.keys()].filter((path) => !path.startsWith('users/'))).toEqual([]);
    expect(docs.get('users/user-1')).toMatchObject({ storeId: null });
  });

  it('없는 사용자 문서는 거부한다', async () => {
    const { service } = makeTransactionalStore({});
    await expect(service.createStore('ghost', { name: '상점' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('이미 storeId가 있거나 소유 매장이 있으면 409로 거부한다', async () => {
    const linked = makeTransactionalStore({
      'users/seller-1': { id: 'seller-1', role: 'seller', storeId: 'store-0' },
    });
    await expect(linked.service.createStore('seller-1', { name: '상점' })).rejects.toBeInstanceOf(
      ConflictException,
    );

    const owned = makeTransactionalStore({
      'users/seller-1': { id: 'seller-1', role: 'seller', storeId: null },
      'stores/store-0': { id: 'store-0', ownerId: 'seller-1' },
    });
    await expect(owned.service.createStore('seller-1', { name: '상점' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('동시에 두 번 요청해도 매장은 하나만 생긴다', async () => {
    const { docs, service } = makeTransactionalStore({
      'users/seller-1': { id: 'seller-1', role: 'seller', storeId: null },
    });

    const results = await Promise.allSettled([
      service.createStore('seller-1', { name: '상점' }),
      service.createStore('seller-1', { name: '상점' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect([...docs.keys()].filter((path) => path.startsWith('stores/'))).toHaveLength(1);
    expect([...docs.keys()].filter((path) => path.startsWith('deliveryFeeConfig/'))).toHaveLength(
      1,
    );
  });

  it('자사 bucket의 본인 로고가 아닌 logoUrl은 아무것도 쓰지 않고 거부한다', async () => {
    const { docs, service } = makeTransactionalStore({
      'users/seller-1': { id: 'seller-1', role: 'seller', storeId: null },
    });

    await expect(
      service.createStore('seller-1', { name: '상점', logoUrl: 'https://evil.example/logo.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect([...docs.keys()]).toEqual(['users/seller-1']);
  });
});

describe('store update logoUrl', () => {
  function makeUpdateService(storeData: Record<string, unknown>) {
    const update = jest.fn().mockResolvedValue(undefined);
    const firestore = {
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => storeData }),
        update,
      }),
      FieldValue: { serverTimestamp: () => 'server-now' },
    };
    return { update, service: new StoresService(firestore as never, makeConfig()) };
  }

  it('본인 로고 업로드 URL로 바꿀 수 있다', async () => {
    const { update, service } = makeUpdateService({ ownerId: 'seller-1', logoUrl: null });
    await service.updateStore('s-1', 'seller-1', { logoUrl: logoUrl('seller-1') });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: logoUrl('seller-1') }));
  });

  it('다른 호스트나 다른 판매자 로고로는 바꿀 수 없다', async () => {
    const { update, service } = makeUpdateService({ ownerId: 'seller-1', logoUrl: null });
    await expect(
      service.updateStore('s-1', 'seller-1', { logoUrl: 'https://evil.example/logo.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateStore('s-1', 'seller-1', { logoUrl: logoUrl('seller-2') }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('이미 저장된 logoUrl을 그대로 다시 보내는 프로필 수정은 통과한다', async () => {
    const legacy = 'https://example.com/legacy-logo.png';
    const { update, service } = makeUpdateService({ ownerId: 'seller-1', logoUrl: legacy });
    await service.updateStore('s-1', 'seller-1', { name: '새 이름', logoUrl: legacy });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ name: '새 이름' }));
  });
});
