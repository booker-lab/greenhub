import { ValidationPipe } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderCapacityService } from './order-capacity.service';
import { RoundOrderCreateService } from './round-order-create.service';

// 전역 ValidationPipe를 거친 주문 본문에는 보내지 않은 선택 칸이 undefined 값으로 남아요(최상위·중첩).
// 유입 경로(acquisition)의 선택 칸을 빼고 보낸 회차 주문이 Firestore 값 오류로 500이 나던 회귀를 막아요.
// 트랜잭션 쓰기 값은 실제 Firestore SDK의 동기 검증(WriteBatch.set/update)을 거쳐요. 네트워크는 쓰지 않아요.

type Data = Record<string, any>;

const snap = (data: Data | null) => ({ exists: data !== null, data: () => data, id: data?.['id'] });

const SEED: Record<string, Data> = {
  'stores/store-round': {
    id: 'store-round',
    salesMode: 'round_direct',
    ownerId: 'seller-1',
    phone: '010-1111-2222',
  },
  'users/user-1': { id: 'user-1', name: '고객', phone: '010-3333-4444' },
  'products/product-1': { id: 'product-1', storeId: 'store-round', name: '호접란', price: 30000 },
  'saleRounds/round-1': {
    id: 'round-1',
    storeId: 'store-round',
    status: 'OPEN',
    schedule: {
      orderOpenAt: '2026-07-14T00:00:00.000+09:00',
      orderCloseAt: '2099-07-20T00:00:00.000+09:00',
      timezone: 'Asia/Seoul',
    },
    deliveryRegion: { city: '이천시', enabled: true },
    limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
  },
  'saleRoundItems/round-item-1': {
    id: 'round-item-1',
    roundId: 'round-1',
    storeId: 'store-round',
    productId: 'product-1',
    productNameSnapshot: '호접란',
    productImageUrlSnapshot: null,
    roundPrice: 30000,
    saleLimitQuantity: 20,
    reservedQuantity: 0,
    orderedQuantity: 0,
    status: 'ACTIVE',
  },
};

describe('회차 주문 생성 Firestore 값 검증', () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    app = admin.initializeApp(
      { projectId: 'demo-round-order-write-spec' },
      `round-order-write-${Date.now()}`,
    );
    db = app.firestore();
  });

  afterAll(async () => {
    await app.delete();
  });

  /** 트랜잭션 쓰기를 실제 SDK로 검증하는 메모리 Firestore. undefined가 있으면 운영처럼 예외가 나요. */
  function makeFirestore() {
    const records = new Map<string, Data>(Object.entries(SEED));
    const doc = (path: string) => ({ path, get: async () => snap(records.get(path) ?? null) });
    const collection = (name: string) => {
      const filters: Array<[string, unknown]> = [];
      const query = {
        where(field: string, _op: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
        async get() {
          const docs = [...records]
            .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2)
            .map(([path, data]) => ({ id: path.split('/')[1], data: () => data }))
            .filter((s) => filters.every(([field, value]) => s.data()[field] === value));
          return { docs };
        },
      };
      return query;
    };
    const runTransaction = async (callback: (tx: unknown) => Promise<unknown>) => {
      const pending = new Map<string, Data>();
      let wrote = false;
      const current = (path: string) => pending.get(path) ?? records.get(path);
      const tx = {
        get: async (ref: { path?: string; get: () => Promise<unknown> }) => {
          if (wrote) throw new Error('Firestore transactions require all reads before all writes');
          return typeof ref.path === 'string' ? snap(current(ref.path) ?? null) : ref.get();
        },
        set: (ref: { path: string }, data: Data, options?: { merge?: boolean }) => {
          if (options) db.batch().set(db.doc(ref.path), data, options);
          else db.batch().set(db.doc(ref.path), data);
          wrote = true;
          pending.set(ref.path, options?.merge ? { ...(current(ref.path) ?? {}), ...data } : data);
        },
        update: (ref: { path: string }, data: Data) => {
          db.batch().update(db.doc(ref.path), data);
          wrote = true;
          pending.set(ref.path, { ...(current(ref.path) ?? {}), ...data });
        },
      };
      const value = await callback(tx);
      for (const [path, data] of pending) records.set(path, data);
      return value;
    };
    const firestore = {
      doc,
      collection,
      runTransaction,
      Timestamp: {
        now: () => new Date('2026-07-15T03:00:00.000+09:00'),
        fromDate: (d: Date) => d,
      },
      FieldValue: admin.firestore.FieldValue,
    };
    const capacity = new OrderCapacityService(firestore as never);
    const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
    const service = new RoundOrderCreateService(
      firestore as never,
      capacity,
      retention as never,
      undefined,
    );
    return { service, records };
  }

  it('유입 경로의 선택 칸을 빼고 보낸 주문도 저장되고, 보내지 않은 칸은 만들지 않아요', async () => {
    const { service, records } = makeFirestore();
    const pipe = new ValidationPipe(sanitizedValidationPipeOptions());
    const dto = (await pipe.transform(
      {
        clientOrderRequestId: 'payment-attempt-acquisition',
        productId: 'product-1',
        quantity: 1,
        saleType: 'normal',
        deliveryMethod: 'direct',
        requestedDeliveryDate: '2026-07-21',
        roundId: 'round-1',
        roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
        deliveryPhone: '010-9999-0000',
        deliveryAddress: {
          address: '경기도 이천시 중리천로 1',
          addressDetail: '201호',
          zipCode: '17373',
        },
        acquisition: { source: 'carrot', capturedAt: '2026-07-15T02:00:00.000+09:00' },
      },
      { type: 'body', metatype: CreateOrderDto },
    )) as CreateOrderDto;
    // 전제: 보내지 않은 선택 칸이 최상위·중첩 모두 undefined 값의 자체 속성으로 남아 있어요.
    expect(Object.hasOwn(dto, 'gift')).toBe(true);
    expect(Object.hasOwn(dto.acquisition!, 'campaign')).toBe(true);

    const result = (await service.create('store-round', 'user-1', dto)) as { orderId: string };

    const order = records.get(`orders/${result.orderId}`)!;
    expect(order['acquisition']).toEqual({
      source: 'carrot',
      capturedAt: '2026-07-15T02:00:00.000+09:00',
    });
    expect(order['totalAmount']).toBe(30000);
  });
});
