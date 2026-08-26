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
