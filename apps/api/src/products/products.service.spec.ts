import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('공개 상품 API', () => {
  it('활성 공개 상품만 조회하고 시험용 상품은 제외한다', async () => {
    const docs = [
      { data: () => ({ id: 'public-001', saleType: 'normal', isActive: true, name: '공개 상품' }) },
      {
        data: () => ({
          id: 'e2e-001',
          saleType: 'normal',
          isActive: true,
          testOnly: true,
          name: '시험용 상품',
        }),
      },
    ];
    const get = jest.fn().mockResolvedValue({ docs });
    const where = jest.fn().mockReturnValue({ get });
    const firestore = {
      collection: jest.fn().mockReturnValue({ where }),
    };
    const service = new ProductsService(firestore as never);

    const result = (await service.getPublicProducts({ isActive: false })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(where).toHaveBeenCalledWith('isActive', '==', true);
    expect(result.items.map((item) => item['id'])).toEqual(['public-001']);
    expect(result.total).toBe(1);
  });

  it.each([
    ['비활성 상품', { id: 'inactive-001', isActive: false, saleType: 'normal' }],
    ['시험용 상품', { id: 'e2e-001', isActive: true, testOnly: true, saleType: 'normal' }],
  ])('%s 상세 조회를 상품 없음으로 처리한다', async (_label, product) => {
    const firestore = {
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => product }),
      }),
    };
    const service = new ProductsService(firestore as never);

    await expect(service.getPublicProduct(product.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('활성 공개 상품 상세는 그대로 반환한다', async () => {
    const product = { id: 'public-001', isActive: true, saleType: 'normal', name: '공개 상품' };
    const firestore = {
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => product }),
      }),
    };
    const service = new ProductsService(firestore as never);

    await expect(service.getPublicProduct(product.id)).resolves.toEqual(product);
  });
});

describe('legacy daily cap 날짜 기본값', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('KST 자정 직후에도 오늘 날짜를 KST 기준으로 조회한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T15:30:00.000Z'));

    const calls: unknown[][] = [];
    const query = {} as {
      where: jest.Mock;
      get: jest.Mock;
    };
    query.where = jest.fn((...args: unknown[]) => {
      calls.push(args);
      return query;
    });
    query.get = jest.fn().mockResolvedValue({ docs: [] });

    const firestore = {
      doc: jest.fn(),
      collection: jest.fn().mockReturnValue(query),
    };
    const service = new ProductsService(firestore as never);

    await service.getDailyCaps('store-1', 'seller-1', undefined, undefined, 'admin');

    expect(calls).toContainEqual(['date', '>=', '2026-08-25']);
    expect(calls).toContainEqual(['date', '<=', '2026-08-25']);
  });
});

describe('legacy daily cap 초기화', () => {
  type Data = Record<string, any>;

  function makeFirestore(initial: Record<string, Data>) {
    const records = new Map(Object.entries(initial));
    const refs = new Map<string, Data>();
    const doc = jest.fn((path: string) => {
      if (!refs.has(path)) {
        refs.set(path, {
          path,
          get: jest.fn(async () => ({
            exists: records.has(path),
            data: () => records.get(path),
          })),
        });
      }
      return refs.get(path);
    });
    const firestore = {
      doc,
      runTransaction: jest.fn(async (callback: (tx: Data) => Promise<unknown>) => {
        const pending = new Map<string, Data>();
        const tx = {
          get: jest.fn(async (ref: Data) => ({
            exists: pending.has(ref.path) || records.has(ref.path),
            data: () => pending.get(ref.path) ?? records.get(ref.path),
          })),
          set: jest.fn((ref: Data, data: Data, options?: { merge?: boolean }) => {
            const current = pending.get(ref.path) ?? records.get(ref.path) ?? {};
            pending.set(ref.path, options?.merge ? { ...current, ...data } : data);
          }),
        };
        const result = await callback(tx);
        for (const [path, data] of pending) records.set(path, data);
        return result;
      }),
    };
    return { firestore, records };
  }

  it('새 daily cap 문서는 usedSlots 0으로 생성한다', async () => {
    const { firestore, records } = makeFirestore({});
    const service = new ProductsService(firestore as never);

    await expect(
      service.updateDailyCap('store-1', '2026-08-25', 'admin-1', 10, 'admin'),
    ).resolves.toMatchObject({
      id: 'store-1_2026-08-25',
      totalCap: 10,
      usedSlots: 0,
    });
    expect(records.get('dailyCaps/store-1_2026-08-25')).toMatchObject({ usedSlots: 0 });
  });

  it('기존 daily cap의 usedSlots와 누락 상태를 totalCap 수정으로 초기화하지 않는다', async () => {
    const { firestore, records } = makeFirestore({
      'dailyCaps/store-1_2026-08-25': { totalCap: 10, usedSlots: 3 },
      'dailyCaps/store-1_2026-08-26': { totalCap: 10 },
    });
    const service = new ProductsService(firestore as never);

    await service.updateDailyCap('store-1', '2026-08-25', 'admin-1', 12, 'admin');
    await service.updateDailyCap('store-1', '2026-08-26', 'admin-1', 12, 'admin');

    expect(records.get('dailyCaps/store-1_2026-08-25')).toMatchObject({
      totalCap: 12,
      usedSlots: 3,
    });
    expect(records.get('dailyCaps/store-1_2026-08-26')).not.toHaveProperty('usedSlots');
  });
});
