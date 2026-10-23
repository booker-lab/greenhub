import { ConflictException, NotFoundException } from '@nestjs/common';
import { EngagementService } from '../engagement/engagement.service';
import { OrdersCreateService } from '../orders/orders-create.service';
import { RoundOrderCreateService } from '../orders/round-order-create.service';
import { ProductsService } from '../products/products.service';
import { SaleRoundsService } from '../sale-rounds/sale-rounds.service';
import { STORE_CLOSED_FOR_ORDERS_MESSAGE, isArchivedStore } from './store-availability';
import { StoresService } from './stores.service';

// 치운(archived) 가게: 손님 화면(가게 소개·상품·회차·배송비·상품 요청)에서 숨고 새 주문이 막힌다.
// 초대 중(invited)·운영 중(active) 가게는 지금처럼 보이고, 판매자 본인 경로는 막지 않는다.

type Docs = Record<string, Record<string, unknown> | undefined>;

function makeFirestore(docs: Docs, collections: Record<string, Record<string, unknown>[]> = {}) {
  const snapshot = (path: string) => {
    const data = docs[path];
    return { exists: data !== undefined, id: path.split('/').at(-1), data: () => data };
  };
  const doc = jest.fn((path: string) => ({ path, get: jest.fn(async () => snapshot(path)) }));
  const query = (name: string): any => ({
    where: () => query(name),
    get: async () => {
      const rows = collections[name] ?? [];
      return { docs: rows.map((row) => ({ data: () => row })), size: rows.length };
    },
  });
  const set = jest.fn();
  return {
    doc,
    set,
    collection: jest.fn((name: string) => query(name)),
    runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: async (ref: { path: string }) => snapshot(ref.path), set, update: set }),
    ),
    Timestamp: { now: () => 'now' },
  };
}

const ARCHIVED = { id: 's-1', name: '치운 가게', status: 'archived', salesMode: 'round_direct' };
const INVITED = { id: 's-1', name: '초대 가게', status: 'invited', salesMode: 'round_direct' };

function storesService(store: Record<string, unknown>) {
  const config = {
    get: (key: string) =>
      ({ NODE_ENV: 'test', FIREBASE_PROJECT_ID: 'unit', FIREBASE_STORAGE_BUCKET: 'unit.appspot.com' })[
        key
      ],
  };
  return new StoresService(makeFirestore({ 'stores/s-1': store }) as never, config as never);
}

describe('치운 가게 기준 함수', () => {
  it('archived만 치운 가게로 본다', () => {
    expect(isArchivedStore({ status: 'archived' })).toBe(true);
    for (const data of [{ status: 'invited' }, { status: 'active' }, {}, undefined, null]) {
      expect(isArchivedStore(data)).toBe(false);
    }
  });
});

describe('치운 가게는 손님 화면에서 숨는다', () => {
  it('가게 공개 소개는 404, 초대 중 가게는 그대로 보인다', async () => {
    await expect(storesService(ARCHIVED).getPublicProfile('s-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(storesService(INVITED).getPublicProfile('s-1')).resolves.toMatchObject({
      id: 's-1',
      name: '초대 가게',
    });
  });

  it('공개 회차 목록·상세는 404', async () => {
    const service = new SaleRoundsService(
      makeFirestore({ 'stores/s-1': ARCHIVED }) as never,
      {} as never,
    );
    await expect(service.listPublicRounds('s-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getPublicRound('s-1', 'r-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('상품 요청은 없는 가게처럼 받지 않는다', async () => {
    const firestore = makeFirestore({ 'stores/s-1': ARCHIVED });
    const service = new EngagementService(firestore as never);
    await expect(service.createProductRequest('s-1', '호접란')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('상품', () => {
    const product = (id: string, storeId: string) => ({
      id,
      storeId,
      name: id,
      isActive: true,
      saleType: 'normal',
      price: 1000,
      createdAt: { seconds: 1 },
    });

    it('가게 단위 목록·상세는 404, 배송비 공개 조회도 404', async () => {
      const firestore = makeFirestore(
        { 'stores/s-1': ARCHIVED, 'products/p-1': product('p-1', 's-1') },
        { products: [product('p-1', 's-1')] },
      );
      const service = new ProductsService(firestore as never);
      await expect(service.getProducts('s-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getProduct('s-1', 'p-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getPublicProduct('p-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getDeliveryConfig('s-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('판매자 본인은 치운 가게의 배송비 설정도 본다', async () => {
      const firestore = makeFirestore({
        'stores/s-1': { ...ARCHIVED, ownerId: 'seller-1' },
        'deliveryFeeConfig/s-1': { storeId: 's-1', directFee: 2500 },
      });
      const service = new ProductsService(firestore as never);
      await expect(service.getOwnerDeliveryConfig('s-1', 'seller-1', 'seller')).resolves.toEqual({
        storeId: 's-1',
        directFee: 2500,
      });
    });

    it('전체 공개 목록에서 치운 가게 상품만 빠지고, 가게 문서는 가게마다 한 번만 읽는다', async () => {
      const firestore = makeFirestore(
        {
          'stores/s-1': ARCHIVED,
          'stores/s-2': { id: 's-2', status: 'invited' },
        },
        {
          products: [
            product('p-1', 's-1'),
            product('p-2', 's-2'),
            product('p-3', 's-2'),
            product('p-4', 's-3'),
          ],
        },
      );
      const service = new ProductsService(firestore as never);

      const result = (await service.getPublicProducts({})) as {
        items: Array<Record<string, unknown>>;
      };

      expect(result.items.map((item) => item['id']).sort()).toEqual(['p-2', 'p-3', 'p-4']);
      expect(firestore.doc.mock.calls.map((call) => call[0]).sort()).toEqual([
        'stores/s-1',
        'stores/s-2',
        'stores/s-3',
      ]);
    });
  });
});

describe('치운 가게는 새 주문을 받지 않는다', () => {
  const parcelOrder = {
    productId: 'p-1',
    quantity: 1,
    saleType: 'normal',
    deliveryMethod: 'parcel',
    deliveryAddress: { address: '서울', addressDetail: '' },
  };

  function ordersCreate(store: Record<string, unknown>) {
    const roundCreate = { create: jest.fn() };
    const firestore = makeFirestore({ 'stores/s-1': store, 'users/u-1': { name: '손님' } });
    const service = new OrdersCreateService(
      firestore as never,
      {} as never,
      {} as never,
      roundCreate as never,
    );
    return { service, roundCreate };
  }

  it.each([
    ['일반', { ...ARCHIVED, salesMode: undefined }],
    ['회차', ARCHIVED],
  ])('%s 가게 주문 생성은 회차 분기 전에 409로 막는다', async (_label, store) => {
    const { service, roundCreate } = ordersCreate(store);

    await expect(service.createOrder('s-1', 'u-1', parcelOrder as never)).rejects.toMatchObject({
      status: 409,
      message: STORE_CLOSED_FOR_ORDERS_MESSAGE,
    });
    expect(roundCreate.create).not.toHaveBeenCalled();
  });

  it('장바구니 확인도 409로 막는다', async () => {
    const { service } = ordersCreate(ARCHIVED);
    await expect(service.validateCart('s-1', 'u-1', parcelOrder as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('회차 주문 트랜잭션 안에서 가게를 다시 확인해 막는다', async () => {
    const firestore = makeFirestore({ 'stores/s-1': ARCHIVED, 'users/u-1': { name: '손님' } });
    const capacity = { reserveCheckoutInTransaction: jest.fn() };
    const service = new RoundOrderCreateService(
      firestore as never,
      capacity as never,
      {} as never,
    );

    await expect(
      service.create('s-1', 'u-1', {
        ...parcelOrder,
        deliveryMethod: 'direct',
        clientOrderRequestId: 'req-1',
        deliveryPhone: '010-1234-5678',
        roundId: 'r-1',
        roundItems: [{ roundItemId: 'ri-1', quantity: 1 }],
      } as never),
    ).rejects.toMatchObject({ status: 409, message: STORE_CLOSED_FOR_ORDERS_MESSAGE });
    expect(capacity.reserveCheckoutInTransaction).not.toHaveBeenCalled();
    expect(firestore.set).not.toHaveBeenCalled();
  });
});
