import { DRIVER_ORDER_AUTHORITY_DENIED, DRIVER_ORDER_NOT_FOUND } from '@greenhub/shared';
import { NotFoundException } from '@nestjs/common';
import { DriverOrderScopeService } from '../orders/driver-order-scope.service';
import { OrdersQueryService } from '../orders/orders-query.service';
import { DriverService } from './driver.service';

type Data = Record<string, any>;

// Firestore Timestamp처럼 toMillis로 시각을 읽는 값.
const timestamp = (iso: string) => {
  const millis = Date.parse(iso);
  return { toMillis: () => millis, toDate: () => new Date(millis) };
};

function comparableMillis(value: unknown): number | null {
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function matchesFilter(data: Data, [field, operator, value]: [string, string, unknown]) {
  if (!(field in data)) return false;
  if (operator === 'in') return Array.isArray(value) && value.includes(data[field]);
  if (operator === '==') return data[field] === value;
  // 범위 비교는 실제 Firestore처럼 같은 타입(Timestamp)끼리만 일치한다.
  const left = comparableMillis(data[field]);
  const right = comparableMillis(value);
  if (left === null || right === null) return false;
  if (operator === '>=') return left >= right;
  if (operator === '<') return left < right;
  throw new Error(`지원하지 않는 연산자: ${operator}`);
}

function makeFirestore(records: Record<string, Data>) {
  // 쿼리마다 필터를 따로 두고, 실제 Firestore처럼 결과를 문서 ID 오름차순으로 돌려준다.
  const reads = { orderDocs: 0 };
  // 실행한 쿼리마다 컬렉션과 필터(필드·연산자·값)를 남겨 쿼리 모양을 확인한다.
  const executedQueries: Array<Array<[string, string, unknown]>> = [];
  const where = jest.fn();
  const orderBy = jest.fn();
  const makeQuery = (
    filters: Array<[string, string, unknown]>,
    orderFields: string[],
  ): Record<string, any> => ({
    where: (field: string, operator: string, value: unknown) => {
      where(field, operator, value);
      return makeQuery([...filters, [field, operator, value]], orderFields);
    },
    // 실제 Firestore처럼 orderBy 필드가 없는 문서는 결과에서 제외한다.
    orderBy: (field: string) => {
      orderBy(field);
      return makeQuery(filters, [...orderFields, field]);
    },
    get: jest.fn(async () => {
      executedQueries.push(filters);
      // 실제 Firestore처럼 == null·in은 필드가 없는 문서와 일치하지 않는다.
      const docs = Object.entries(records)
        .filter(([path]) => path.startsWith('orders/'))
        .filter(([, data]) => filters.every((filter) => matchesFilter(data, filter)))
        .filter(([, data]) => orderFields.every((field) => field in data))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([path, data]) => ({
          id: path.split('/')[1],
          data: () => data,
        }));
      reads.orderDocs += docs.length;
      return { docs };
    }),
  });
  const query = { where, orderBy };
  const firestore = {
    Timestamp: { fromDate: (date: Date) => timestamp(date.toISOString()) },
    collection: jest.fn((_path: string) => makeQuery([], [])),
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => ({
        exists: path in records,
        data: () => records[path],
      })),
    })),
  };
  return { firestore, query, reads, executedQueries };
}

function makeService(
  records: Record<string, Data>,
  driver: Data = { role: 'driver', driverApproved: true },
) {
  const { firestore, query, reads, executedQueries } = makeFirestore(records);
  records['users/driver-1'] = { id: 'driver-1', ...driver };
  const ordersQuery = new OrdersQueryService(firestore as never);
  const driverScope = new DriverOrderScopeService(firestore as never);
  return {
    service: new DriverService(firestore as never, ordersQuery, driverScope),
    driverScope,
    query,
    firestore,
    reads,
    executedQueries,
  };
}

// 이 변경 전 목록 구현: 노출 대상 status 주문을 매장·기사와 관계없이 모두 읽은 뒤 메모리에서 판정한다.
async function previousListIds(
  firestore: ReturnType<typeof makeFirestore>['firestore'],
  driverScope: DriverOrderScopeService,
  driverId: string,
  statuses: string[],
): Promise<string[]> {
  const millis = (value: unknown) => (typeof value === 'string' ? new Date(value).getTime() : null);
  const snap = await firestore.collection('orders').where('status', 'in', statuses).get();
  const candidates = snap.docs
    .map((d: { id: string; data: () => Data }) => ({ id: d.id, ...d.data() }))
    .sort((a: Data, b: Data) => {
      const aKey = millis(a.preparedAt) ?? millis(a.updatedAt);
      const bKey = millis(b.preparedAt) ?? millis(b.updatedAt);
      if (aKey === bKey) return 0;
      if (aKey === null) return 1;
      if (bKey === null) return -1;
      return aKey - bKey;
    });
  const visible = await driverScope.filterVisibleOrders(candidates, driverId);
  return visible.map((order: Data) => order.id);
}

// 본인·다른 기사 배정, driverId가 null인 미배정과 필드 자체가 없는 이전 미배정, 비활성 상태,
// 여러 매장(round_direct·legacy·매장 없음·없는 매장)을 섞은 목록 fixture.
function mixedBoardRecords(): Record<string, Data> {
  const pilot = { storeId: 'pilot', schemaVersion: 2, roundId: 'round-valid' };
  return {
    'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
    'stores/legacy': { id: 'legacy', salesMode: 'legacy' },
    'saleRounds/round-valid': { id: 'round-valid', storeId: 'pilot' },
    'orders/mine-preparing-redelivery': {
      storeId: 'legacy',
      status: 'PREPARING',
      deliveryMethod: 'direct',
      driverId: 'driver-1',
      updatedAt: '2026-09-01T03:00:00Z',
    },
    'orders/mine-preparing-parcel': {
      status: 'PREPARING',
      deliveryMethod: 'parcel',
      driverId: 'driver-1',
    },
    'orders/mine-delivering-pilot': {
      ...pilot,
      status: 'DELIVERING',
      deliveryMethod: 'direct',
      driverId: 'driver-1',
      preparedAt: '2026-09-01T01:00:00Z',
    },
    'orders/mine-held-hub': {
      status: 'DELIVERY_HELD',
      deliveryMethod: 'hub',
      driverId: 'driver-1',
      updatedAt: '2026-09-01T03:00:00Z',
    },
    'orders/mine-delivered': {
      status: 'DELIVERED',
      deliveryMethod: 'direct',
      driverId: 'driver-1',
    },
    'orders/mine-pilot-without-schema': {
      storeId: 'pilot',
      roundId: 'round-valid',
      status: 'DELIVERING',
      deliveryMethod: 'direct',
      driverId: 'driver-1',
    },
    'orders/other-preparing': {
      storeId: 'legacy',
      status: 'PREPARING',
      deliveryMethod: 'direct',
      driverId: 'driver-2',
    },
    'orders/other-delivering-pilot': {
      ...pilot,
      status: 'DELIVERING',
      deliveryMethod: 'direct',
      driverId: 'driver-2',
    },
    'orders/other-delivering-legacy': {
      storeId: 'legacy',
      status: 'DELIVERING',
      deliveryMethod: 'hub',
      driverId: 'driver-3',
    },
    'orders/other-held': {
      status: 'DELIVERY_HELD',
      deliveryMethod: 'direct',
      driverId: 'driver-2',
    },
    'orders/unassigned-null-direct': {
      storeId: 'legacy',
      status: 'PREPARING',
      deliveryMethod: 'direct',
      driverId: null,
      updatedAt: '2026-09-01T02:00:00Z',
    },
    'orders/unassigned-missing-hub': {
      status: 'PREPARING',
      deliveryMethod: 'hub',
      updatedAt: '2026-09-01T03:00:00Z',
    },
    'orders/unassigned-missing-pilot': {
      ...pilot,
      status: 'PREPARING',
      deliveryMethod: 'direct',
      preparedAt: '2026-09-01T00:30:00Z',
    },
    'orders/unassigned-missing-pilot-hub': { ...pilot, status: 'PREPARING', deliveryMethod: 'hub' },
    'orders/unassigned-missing-parcel': { status: 'PREPARING', deliveryMethod: 'parcel' },
    'orders/unassigned-missing-cancelling': {
      status: 'PREPARING',
      deliveryMethod: 'direct',
      cancellation: { status: 'REFUNDING' },
    },
    'orders/unassigned-missing-pilot-no-round': {
      storeId: 'pilot',
      schemaVersion: 2,
      status: 'PREPARING',
      deliveryMethod: 'direct',
    },
    'orders/unassigned-missing-ghost-store': {
      storeId: 'ghost',
      status: 'PREPARING',
      deliveryMethod: 'direct',
    },
    'orders/unassigned-null-delivering': {
      status: 'DELIVERING',
      deliveryMethod: 'direct',
      driverId: null,
    },
    'orders/unassigned-accepted': { status: 'ACCEPTED', deliveryMethod: 'direct' },
    'orders/unassigned-cancelled': { status: 'CANCELLED', deliveryMethod: 'hub', driverId: null },
  };
}

const paymentFields = [
  'required',
  'holdAt',
  'chargeId',
  'status',
  'canPay',
  'paid',
  'requiresRecovery',
];

describe('DriverService 주문 노출 범위와 읽기 계약', () => {
  it('미배정 PREPARING direct·hub와 본인 배정 PREPARING을 반환한다', async () => {
    const { service } = makeService({
      'orders/pickup-direct': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
      },
      'orders/pickup-hub': {
        status: 'PREPARING',
        deliveryMethod: 'hub',
        driverId: null,
      },
      'orders/pickup-parcel': {
        status: 'PREPARING',
        deliveryMethod: 'parcel',
        driverId: null,
      },
      'orders/assigned-preparing': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/other-driver': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-2',
      },
    });

    const result = await service.getOrders('driver-1');

    // 시각이 같으면 Firestore 기본 정렬처럼 문서 ID 순이다.
    expect(result.map((order) => order.id)).toEqual([
      'assigned-preparing',
      'pickup-direct',
      'pickup-hub',
    ]);
  });

  it('본인 배정 DELIVERY_HELD·DELIVERING을 반환하고 다른 기사는 제외한다', async () => {
    const { service } = makeService({
      'orders/assigned-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/assigned-delivering': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/other-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-2',
      },
      'orders/finished': {
        status: 'DELIVERED',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual(['assigned-delivering', 'assigned-held']);
  });

  it('preparedAt이 없는 주문도 제외하지 않고 preparedAt, 없으면 updatedAt 순으로 정렬한다', async () => {
    const at = (iso: string) => ({ toMillis: () => new Date(iso).getTime() });
    const { service, query } = makeService({
      'orders/held-without-prepared-at': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        updatedAt: at('2026-09-01T02:00:00Z'),
      },
      'orders/prepared-early': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        preparedAt: at('2026-09-01T01:00:00Z'),
      },
      'orders/no-timestamps': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/prepared-late': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        preparedAt: at('2026-09-01T03:00:00Z'),
      },
    });

    const result = await service.getOrders('driver-1');

    expect(query.orderBy).not.toHaveBeenCalled();
    expect(result.map((order) => order.id)).toEqual([
      'prepared-early',
      'held-without-prepared-at',
      'prepared-late',
      'no-timestamps',
    ]);
  });

  it('status 필터에서도 DELIVERY_HELD를 포함한 기존 discovery 범위를 유지한다', async () => {
    const { service, query } = makeService({
      'orders/assigned-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
    });

    await expect(service.getOrders('driver-1', 'DELIVERY_HELD')).resolves.toHaveLength(1);
    expect(query.where).toHaveBeenCalledWith('driverId', '==', 'driver-1');
    expect(query.where).toHaveBeenCalledWith('status', 'in', ['DELIVERY_HELD']);
    // PREPARING을 요청하지 않으면 미배정 discovery 후보 쿼리를 보내지 않는다.
    expect(query.where).not.toHaveBeenCalledWith('deliveryMethod', 'in', expect.anything());
  });

  it('payment-required PREPARING·DELIVERY_HELD 주문에 authoritative 7개 필드를 포함한다', async () => {
    const hold = {
      heldAt: '2026-08-26T00:00:00.000Z',
      customerResponsible: true,
      redeliveryFee: 5000,
      resolvedAt: null,
    };
    const { service } = makeService({
      'orders/payment-preparing': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        deliveryHold: hold,
      },
      'orders/payment-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        deliveryHold: hold,
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result).toHaveLength(2);
    for (const order of result) {
      expect(order.redeliveryPayment).toEqual(
        expect.objectContaining({
          required: true,
          status: 'MISSING',
        }),
      );
      expect(Object.keys(order.redeliveryPayment).sort()).toEqual([...paymentFields].sort());
    }
  });

  it('명시적 allowlist만 반환하고 미배정 discovery의 전화번호와 내부 필드를 제거한다', async () => {
    const internalFields = {
      userId: 'consumer-1',
      productId: 'product-1',
      totalAmount: 15000,
      deliveryFee: 3000,
      orderItems: [{ productId: 'product-1', unitPrice: 12000, subtotalAmount: 12000 }],
      redeliveryChargeId: 'charge-1',
      redeliveryChargeHoldAt: '2026-08-26T00:00:00.000Z',
      reservationId: 'reservation-1',
      clientOrderPayloadHash: 'hash',
      marketingConsent: { agreed: true },
      acquisition: { source: 'direct' },
      deliveryPhotoIds: ['photo-1'],
      deliveryPhone: '010-0000-0000',
      requestNote: '받는 분 김그린 010-3333-3333',
      driverId: null,
    };
    const { service } = makeService({
      'orders/discovery': {
        ...internalFields,
        status: 'PREPARING',
        deliveryMethod: 'direct',
        buyerName: '소비자',
        buyerPhone: '010-1111-1111',
        sellerPhone: '010-2222-2222',
        address: '서울시 중구',
        lat: 37.56,
        lng: 126.98,
      },
      'orders/assigned-preparing': {
        ...internalFields,
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        sellerPhone: '010-2222-2222',
      },
      'orders/assigned-delivering': {
        ...internalFields,
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        buyerPhone: '010-1111-1111',
        sellerPhone: '010-2222-2222',
      },
    });

    const result = await service.getOrders('driver-1');
    const discovery = result.find((order) => order.id === 'discovery');
    expect(discovery).toMatchObject({
      id: 'discovery',
      address: '서울시 중구',
      lat: 37.56,
      lng: 126.98,
    });
    for (const order of result) {
      for (const field of [
        'userId',
        'productId',
        'totalAmount',
        'deliveryFee',
        'orderItems',
        'redeliveryChargeId',
        'redeliveryChargeHoldAt',
        'reservationId',
        'clientOrderPayloadHash',
        'marketingConsent',
        'acquisition',
        'deliveryPhotoIds',
        'deliveryPhone',
        'requestNote',
        'buyerPhone',
        'sellerPhone',
        'driverId',
      ]) {
        expect(order).not.toHaveProperty(field);
      }
    }

    await expect(service.getOrder('driver-1', 'discovery')).resolves.not.toHaveProperty(
      'sellerPhone',
    );
    await expect(service.getOrder('driver-1', 'discovery')).resolves.not.toHaveProperty(
      'buyerPhone',
    );
    await expect(service.getOrder('driver-1', 'assigned-preparing')).resolves.toHaveProperty(
      'sellerPhone',
      '010-2222-2222',
    );
    await expect(service.getOrder('driver-1', 'assigned-preparing')).resolves.not.toHaveProperty(
      'buyerPhone',
    );
    // 고객 전화는 결제 때 받은 수령 연락처(deliveryPhone)를 우선한다.
    await expect(service.getOrder('driver-1', 'assigned-delivering')).resolves.toHaveProperty(
      'buyerPhone',
      '010-0000-0000',
    );
    await expect(service.getOrder('driver-1', 'discovery')).resolves.not.toHaveProperty(
      'requestNote',
    );
    await expect(service.getOrder('driver-1', 'assigned-preparing')).resolves.toHaveProperty(
      'requestNote',
      '받는 분 김그린 010-3333-3333',
    );
  });

  it('목록·상세에 상품별 이름·수량만 싣고 가격·상품 ID는 싣지 않는다', async () => {
    const { service } = makeService({
      'orders/round-two-items': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
        productName: '동양란 만천홍',
        quantity: 3,
        orderItems: [
          {
            roundItemId: 'round-item-1',
            productId: 'product-1',
            productName: '동양란 만천홍',
            productImageUrl: 'https://example.com/1.jpg',
            unitPrice: 30000,
            quantity: 2,
            subtotalAmount: 60000,
          },
          {
            roundItemId: 'round-item-2',
            productId: 'product-2',
            productName: '호접란',
            productImageUrl: null,
            unitPrice: 50000,
            quantity: 1,
            subtotalAmount: 50000,
          },
        ],
      },
      'orders/legacy-single': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
        productId: 'product-legacy',
        productName: '산세베리아',
        quantity: 2,
        totalAmount: 40000,
      },
      'orders/malformed-items': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
        productName: '동양란',
        quantity: 2,
        orderItems: [
          { productName: '동양란', quantity: 1 },
          { productName: ' ', quantity: 1 },
        ],
      },
    });
    const expectedItems = [
      { productName: '동양란 만천홍', quantity: 2 },
      { productName: '호접란', quantity: 1 },
    ];

    const list = await service.getOrders('driver-1');
    const byId = Object.fromEntries(list.map((order) => [order.id, order]));
    expect(byId['round-two-items'].items).toEqual(expectedItems);
    for (const item of byId['round-two-items'].items as Array<Record<string, unknown>>) {
      expect(Object.keys(item).sort()).toEqual(['productName', 'quantity']);
    }
    // 상품 스냅샷이 없는 이전 주문은 주문의 상품·수량 한 줄이 된다.
    expect(byId['legacy-single'].items).toEqual([{ productName: '산세베리아', quantity: 2 }]);
    // 하나라도 어긋나면 통째로 빼서 앱이 기존 한 줄 표기로 대신한다.
    expect(byId['malformed-items']).not.toHaveProperty('items');

    const detail = await service.getOrder('driver-1', 'round-two-items');
    expect(detail.items).toEqual(expectedItems);
    expect(detail).not.toHaveProperty('orderItems');
  });

  it('목록은 전체 주소를 싣는 행에만 지도 검색용 기본 주소를 함께 싣는다', async () => {
    const { service } = makeService({
      'orders/with-address': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
        address: '경기도 이천시 중리천로 1 101동 1001호',
        deliveryAddress: {
          address: '경기도 이천시 중리천로 1',
          addressDetail: '101동 1001호',
          zipCode: '17379',
        },
      },
      'orders/without-address': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
        deliveryAddress: { addressDetail: '101동 1001호', zipCode: '17379' },
      },
    });

    const list = await service.getOrders('driver-1');
    const withAddress = list.find((order) => order.id === 'with-address');
    expect(withAddress).toMatchObject({ address: '경기도 이천시 중리천로 1 101동 1001호' });
    // 상세 주소·우편번호는 목록에 따로 싣지 않는다.
    expect(withAddress?.['deliveryAddress']).toEqual({ address: '경기도 이천시 중리천로 1' });
    expect(list.find((order) => order.id === 'without-address')).not.toHaveProperty(
      'deliveryAddress',
    );
  });

  it('본인 배정 직배송의 배송 중·보류 상세에 수령 연락처 우선 고객 전화를 반환한다', async () => {
    const { service } = makeService({
      'orders/delivering-profile-only': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        buyerPhone: '010-1111-1111',
      },
      'orders/delivering-kakao': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        buyerPhone: null,
        deliveryPhone: '010-3333-3333',
      },
      'orders/held-direct': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        buyerPhone: null,
        deliveryPhone: '010-3333-3333',
        sellerPhone: '010-2222-2222',
      },
      'orders/held-hub': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'hub',
        driverId: 'driver-1',
        buyerPhone: '010-1111-1111',
        deliveryPhone: '010-3333-3333',
      },
    });

    // deliveryPhone이 없는 과거 주문은 가입 프로필 전화로 대체한다.
    await expect(service.getOrder('driver-1', 'delivering-profile-only')).resolves.toHaveProperty(
      'buyerPhone',
      '010-1111-1111',
    );
    // 카카오 가입자처럼 프로필 전화가 없어도 수령 연락처를 반환한다.
    await expect(service.getOrder('driver-1', 'delivering-kakao')).resolves.toHaveProperty(
      'buyerPhone',
      '010-3333-3333',
    );
    // 보류 주문은 재배송 연락을 위해 고객 전화를 반환하고 판매자 전화는 그대로 숨긴다.
    const held = await service.getOrder('driver-1', 'held-direct');
    expect(held).toHaveProperty('buyerPhone', '010-3333-3333');
    expect(held).not.toHaveProperty('sellerPhone');
    expect(held).not.toHaveProperty('deliveryPhone');
    // 거점 주문은 보류여도 소비자 연락처를 노출하지 않는다.
    await expect(service.getOrder('driver-1', 'held-hub')).resolves.not.toHaveProperty(
      'buyerPhone',
    );
    // 목록 응답에는 어떤 전화번호도 싣지 않는다.
    for (const order of await service.getOrders('driver-1')) {
      expect(order).not.toHaveProperty('buyerPhone');
      expect(order).not.toHaveProperty('deliveryPhone');
    }
  });

  it('상세 보류 정보도 화면에 필요한 필드만 반환한다', async () => {
    const { service } = makeService({
      'orders/held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        deliveryHold: {
          heldAt: '2026-08-26T00:00:00.000Z',
          reasonCode: 'ACCESS_UNAVAILABLE',
          reasonMessage: '출입 불가',
          customerResponsible: false,
          redeliveryFee: null,
          nextContactAt: '2026-08-27T00:00:00.000Z',
          nextDeliveryAt: '2026-08-28T00:00:00.000Z',
          resolvedAt: null,
        },
      },
    });

    await expect(service.getOrder('driver-1', 'held')).resolves.toMatchObject({
      deliveryHold: {
        reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '출입 불가',
        customerResponsible: false,
        redeliveryFee: null,
        nextContactAt: '2026-08-27T00:00:00.000Z',
        nextDeliveryAt: '2026-08-28T00:00:00.000Z',
      },
    });
    await expect(service.getOrder('driver-1', 'held')).resolves.not.toHaveProperty(
      'deliveryHold.heldAt',
    );
    await expect(service.getOrder('driver-1', 'held')).resolves.not.toHaveProperty(
      'deliveryHold.resolvedAt',
    );
  });

  it('상세에 가장 최근 보류 표시(heldAt)만 deliveryHoldAt으로 싣고, 재개 뒤 배송 중에도 남긴다', async () => {
    const { service } = makeService({
      'orders/resumed': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        deliveryHold: {
          heldAt: '2026-08-26T00:00:00.000Z',
          reasonCode: 'ACCESS_UNAVAILABLE',
          reasonMessage: '출입 불가',
          resolvedAt: '2026-08-26T01:00:00.000Z',
        },
      },
      'orders/fresh': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
    });

    const resumed = await service.getOrder('driver-1', 'resumed');
    expect(resumed.deliveryHoldAt).toBe('2026-08-26T00:00:00.000Z');
    // 배송 중 주문에는 보류 사유 등 다른 보류 필드를 싣지 않는다.
    expect(resumed).not.toHaveProperty('deliveryHold');
    await expect(service.getOrder('driver-1', 'fresh')).resolves.toMatchObject({
      deliveryHoldAt: null,
    });
  });

  it('상세도 목록과 동일한 visibility contract를 적용하고 arbitrary read를 거부한다', async () => {
    const { service } = makeService({
      'orders/unassigned-direct': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
      },
      'orders/unassigned-hub': {
        status: 'PREPARING',
        deliveryMethod: 'hub',
        driverId: null,
      },
      'orders/assigned-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/other-driver': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-2',
      },
      'orders/arbitrary': {
        status: 'DELIVERED',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
    });

    await expect(service.getOrder('driver-1', 'unassigned-direct')).resolves.toMatchObject({
      id: 'unassigned-direct',
    });
    await expect(service.getOrder('driver-1', 'unassigned-hub')).resolves.toMatchObject({
      id: 'unassigned-hub',
    });
    await expect(service.getOrder('driver-1', 'assigned-held')).resolves.toMatchObject({
      id: 'assigned-held',
    });
    await expect(service.getOrder('driver-1', 'other-driver')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getOrder('driver-1', 'arbitrary')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getOrder('driver-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('round_direct 목록은 Pilot base와 direct discovery만 허용하고 legacy direct·hub는 보존한다', async () => {
    const { service } = makeService({
      'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
      'stores/legacy': { id: 'legacy', salesMode: 'legacy' },
      'stores/missing-mode': { id: 'missing-mode' },
      'stores/foreign': { id: 'foreign', salesMode: 'round_direct' },
      'saleRounds/round-valid': { id: 'round-valid', storeId: 'pilot' },
      'saleRounds/round-foreign': { id: 'round-foreign', storeId: 'foreign' },
      'orders/pilot-valid': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/pilot-assigned': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-1',
      },
      'orders/pilot-other-driver': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-2',
      },
      'orders/missing-schema': {
        storeId: 'pilot',
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/missing-round-id': {
        storeId: 'pilot',
        schemaVersion: 2,
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/invalid-round-id': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-missing',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/foreign-round': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-foreign',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/pilot-hub': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'hub',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/pilot-parcel': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'parcel',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/legacy-direct': {
        storeId: 'legacy',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/legacy-hub': {
        storeId: 'missing-mode',
        deliveryMethod: 'hub',
        status: 'PREPARING',
        driverId: null,
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual([
      'legacy-direct',
      'legacy-hub',
      'pilot-assigned',
      'pilot-valid',
    ]);
  });

  it('목록 한 번의 요청에서 같은 stores·saleRounds 문서는 주문 수와 관계없이 정해진 횟수만 읽는다', async () => {
    const records: Record<string, Data> = {
      'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
      'stores/legacy': { id: 'legacy', salesMode: 'legacy' },
      'saleRounds/round-valid': { id: 'round-valid', storeId: 'pilot' },
    };
    for (let i = 0; i < 4; i += 1) {
      records[`orders/pilot-${i}`] = {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
        updatedAt: `2026-01-01T00:0${i}:00.000Z`,
      };
      records[`orders/legacy-${i}`] = {
        storeId: 'legacy',
        deliveryMethod: 'hub',
        status: 'PREPARING',
        driverId: null,
        updatedAt: `2026-01-01T01:0${i}:00.000Z`,
      };
    }
    const { service, firestore } = makeService(records);

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual([
      'pilot-0',
      'pilot-1',
      'pilot-2',
      'pilot-3',
      'legacy-0',
      'legacy-1',
      'legacy-2',
      'legacy-3',
    ]);
    const readCount = (path: string) =>
      firestore.doc.mock.calls.filter(([called]) => called === path).length;
    expect(readCount('stores/pilot')).toBe(1);
    expect(readCount('stores/legacy')).toBe(1);
    // 노출 판정에서 1회만 읽고 배송일은 그 문서를 그대로 쓴다. 같은 회차 주문이 늘어도 그대로다.
    expect(readCount('saleRounds/round-valid')).toBe(1);
  });

  it('목록·상세에 요청 기사 본인 배정 여부만 assignedToMe로 싣는다', async () => {
    const { service } = makeService({
      'orders/mine': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/open': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
      },
      'orders/legacy-open': {
        status: 'PREPARING',
        deliveryMethod: 'hub',
      },
      'orders/mine-delivering': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
    });

    const list = await service.getOrders('driver-1');
    expect(Object.fromEntries(list.map((order) => [order.id, order['assignedToMe']]))).toEqual({
      mine: true,
      open: false,
      'legacy-open': false,
      'mine-delivering': true,
    });
    for (const order of list) expect(order).not.toHaveProperty('driverId');
    await expect(service.getOrder('driver-1', 'mine')).resolves.toMatchObject({
      assignedToMe: true,
    });
    await expect(service.getOrder('driver-1', 'open')).resolves.toMatchObject({
      assignedToMe: false,
    });
  });

  it('회차 주문 목록 행에 회차 배송 시작 시각을 싣고 회차 문서는 회차마다 한 번만 읽는다', async () => {
    const records: Record<string, Data> = {
      'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
      'stores/legacy': { id: 'legacy', salesMode: 'legacy' },
      'saleRounds/round-a': {
        id: 'round-a',
        storeId: 'pilot',
        schedule: { deliveryStartAt: '2026-11-10T01:00:00.000Z', timezone: 'Asia/Seoul' },
      },
      // Firestore Timestamp로 저장된 일정도 ISO로 바꿔 싣는다.
      'saleRounds/round-b': {
        id: 'round-b',
        storeId: 'pilot',
        schedule: {
          deliveryStartAt: { toMillis: () => Date.parse('2026-11-12T00:30:00.000Z') },
          timezone: 'Asia/Seoul',
        },
      },
    };
    for (let i = 0; i < 6; i += 1) {
      records[`orders/a-${i}`] = {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-a',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
        updatedAt: `2026-01-01T00:0${i}:00.000Z`,
      };
      records[`orders/b-${i}`] = {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-b',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-1',
        updatedAt: `2026-01-01T01:0${i}:00.000Z`,
      };
    }
    records['orders/legacy'] = {
      storeId: 'legacy',
      deliveryMethod: 'hub',
      status: 'PREPARING',
      driverId: null,
      updatedAt: '2026-01-01T02:00:00.000Z',
    };
    const { service, firestore } = makeService(records);

    const result = await service.getOrders('driver-1');

    expect(result).toHaveLength(13);
    for (const order of result) {
      if (String(order.id).startsWith('a-')) {
        expect(order['deliveryDate']).toBe('2026-11-10T01:00:00.000Z');
      } else if (String(order.id).startsWith('b-')) {
        expect(order['deliveryDate']).toBe('2026-11-12T00:30:00.000Z');
      } else {
        expect(order).not.toHaveProperty('deliveryDate');
      }
    }
    const readCount = (path: string) =>
      firestore.doc.mock.calls.filter(([called]) => called === path).length;
    // 주문 12건이어도 회차마다 노출 판정에서 1회만 읽고, 배송일은 그 문서를 그대로 쓴다.
    expect(readCount('saleRounds/round-a')).toBe(1);
    expect(readCount('saleRounds/round-b')).toBe(1);
    expect(
      firestore.doc.mock.calls.filter(([called]) => String(called).startsWith('saleRounds/')),
    ).toHaveLength(2);
  });

  it('배송일은 노출 판정이 회차 직배송으로 본 주문에만 싣고 legacy 판매점 주문에 남은 roundId로는 싣지 않는다', async () => {
    const schedule = { deliveryStartAt: '2026-11-10T01:00:00.000Z' };
    const { service, firestore } = makeService({
      'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
      'stores/legacy': { id: 'legacy', salesMode: 'legacy' },
      'saleRounds/round-pilot': { id: 'round-pilot', storeId: 'pilot', schedule },
      // 회차 문서의 id·storeId가 legacy 주문과 맞아도 판매점이 legacy면 회차 직배송이 아니다.
      'saleRounds/round-legacy': { id: 'round-legacy', storeId: 'legacy', schedule },
      // storeId가 없는 이전 주문과 storeId가 없는 회차 문서도 서로 맞는 것으로 보지 않는다.
      'saleRounds/round-storeless': { id: 'round-storeless', schedule },
      'orders/pilot': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-pilot',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      'orders/legacy-open': {
        storeId: 'legacy',
        schemaVersion: 2,
        roundId: 'round-legacy',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
        updatedAt: '2026-01-01T00:01:00.000Z',
      },
      'orders/legacy-mine': {
        storeId: 'legacy',
        schemaVersion: 2,
        roundId: 'round-legacy',
        deliveryMethod: 'hub',
        status: 'DELIVERING',
        driverId: 'driver-1',
        updatedAt: '2026-01-01T00:02:00.000Z',
      },
      'orders/storeless': {
        roundId: 'round-storeless',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
        updatedAt: '2026-01-01T00:03:00.000Z',
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual([
      'pilot',
      'legacy-open',
      'legacy-mine',
      'storeless',
    ]);
    expect(result[0]['deliveryDate']).toBe('2026-11-10T01:00:00.000Z');
    for (const order of result.slice(1)) expect(order).not.toHaveProperty('deliveryDate');
    // legacy 판매점·storeId 없는 주문의 회차 문서는 노출 판정에 필요 없으므로 읽지 않는다.
    expect(
      firestore.doc.mock.calls
        .map(([called]) => String(called))
        .filter((called) => called.startsWith('saleRounds/')),
    ).toEqual(['saleRounds/round-pilot']);
  });

  it('노출 판정 뒤 같은 회차 문서를 다시 읽지 않아 이후 읽기가 실패해도 배송일이 빠지지 않는다', async () => {
    const { service, firestore } = makeService({
      'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
      'saleRounds/round-a': {
        id: 'round-a',
        storeId: 'pilot',
        schedule: { deliveryStartAt: '2026-11-10T01:00:00.000Z' },
      },
      'orders/a': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-a',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
    });
    const baseDoc = firestore.doc.getMockImplementation()!;
    let roundReads = 0;
    firestore.doc.mockImplementation((path: string) => {
      if (path === 'saleRounds/round-a' && ++roundReads > 1) {
        return { get: jest.fn(async () => Promise.reject(new Error('unavailable'))) };
      }
      return baseDoc(path);
    });

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual(['a']);
    expect(result[0]['deliveryDate']).toBe('2026-11-10T01:00:00.000Z');
    expect(roundReads).toBe(1);
  });

  it.each([
    ['일정이 없는 회차', undefined],
    [
      '배송 시작 시각을 읽다 오류가 나는 회차',
      {
        deliveryStartAt: {
          toMillis: () => {
            throw new Error('broken');
          },
        },
      },
    ],
    ['ISO로 바꿀 수 없는 배송 시작 시각', { deliveryStartAt: 8.64e15 + 1 }],
  ])('%s면 목록은 그대로 두고 배송일만 뺀다', async (_label, schedule) => {
    const { service } = makeService({
      'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
      'saleRounds/round-a': { id: 'round-a', storeId: 'pilot', schedule },
      'orders/a': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-a',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual(['a']);
    expect(result[0]).not.toHaveProperty('deliveryDate');
  });

  it.each([
    [undefined],
    ['PREPARING'],
    ['DELIVERING'],
    ['DELIVERY_HELD'],
    ['PREPARING,DELIVERY_HELD'],
    ['DELIVERING,DELIVERY_HELD'],
  ])('status=%s 목록이 이전 전체 조회 구현과 같은 주문을 같은 순서로 반환한다', async (status) => {
    const { service, firestore, driverScope } = makeService(mixedBoardRecords());
    const statuses = status ? status.split(',') : ['PREPARING', 'DELIVERING', 'DELIVERY_HELD'];

    const result = (await service.getOrders('driver-1', status)).map((order) => order.id);

    expect(result).toEqual(await previousListIds(firestore, driverScope, 'driver-1', statuses));
  });

  it('고객 사유 종결(CLOSED_UNDELIVERED) 주문은 본인 배정이어도 목록에 나오지 않는다', async () => {
    const { service } = makeService({
      ...mixedBoardRecords(),
      'orders/mine-closed-undelivered': {
        storeId: 'pilot',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        status: 'CLOSED_UNDELIVERED',
        preparedAt: timestamp('2026-11-10T01:00:00.000Z'),
        updatedAt: timestamp('2026-11-10T01:00:00.000Z'),
      },
    });

    const result = (await service.getOrders('driver-1')).map((order) => order.id);

    expect(result).not.toContain('mine-closed-undelivered');
  });

  it('driverId 필드가 없는 이전 미배정 주문도 목록에서 빠지지 않는다', async () => {
    const { service } = makeService(mixedBoardRecords());

    const result = (await service.getOrders('driver-1')).map((order) => order.id);

    expect(result).toEqual([
      'unassigned-missing-pilot',
      'mine-delivering-pilot',
      'unassigned-null-direct',
      'mine-held-hub',
      'mine-preparing-redelivery',
      'unassigned-missing-hub',
      'mine-preparing-parcel',
    ]);
  });

  it('다른 기사의 배송 주문이 대부분이어도 본인 배정과 미배정 후보 주문만 읽는다', async () => {
    const records: Record<string, Data> = {
      'stores/legacy': { id: 'legacy', salesMode: 'legacy' },
      'orders/mine': {
        storeId: 'legacy',
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/open': { storeId: 'legacy', status: 'PREPARING', deliveryMethod: 'hub' },
    };
    for (let i = 0; i < 30; i += 1) {
      records[`orders/other-${String(i).padStart(2, '0')}`] = {
        storeId: i % 3 === 0 ? 'legacy' : `store-${i % 3}`,
        status: i % 2 === 0 ? 'DELIVERING' : 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: `driver-${(i % 4) + 2}`,
      };
    }
    for (let i = 0; i < 5; i += 1) {
      records[`orders/parcel-${i}`] = { status: 'PREPARING', deliveryMethod: 'parcel' };
      records[`orders/done-${i}`] = {
        status: 'DELIVERED',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      };
    }
    const { service, firestore, driverScope, reads } = makeService(records);

    const result = (await service.getOrders('driver-1')).map((order) => order.id);
    const narrowedReads = reads.orderDocs;
    reads.orderDocs = 0;
    const previous = await previousListIds(firestore, driverScope, 'driver-1', [
      'PREPARING',
      'DELIVERING',
      'DELIVERY_HELD',
    ]);

    expect(result).toEqual(previous);
    expect(result).toEqual(['mine', 'open']);
    expect(narrowedReads).toBe(2);
    expect(reads.orderDocs).toBe(37);
  });

  it.each([
    ['승인 필드가 정확한 true가 아님', { role: 'driver', driverApproved: false }],
    ['정지됨', { role: 'driver', driverApproved: true, suspended: true }],
    ['driver 역할이 아님', { role: 'consumer', driverApproved: true }],
  ])('%s이면 Driver 목록과 상세를 거부한다', async (_label, driver) => {
    const { service } = makeService(
      {
        'orders/order-1': {
          status: 'PREPARING',
          deliveryMethod: 'direct',
          driverId: null,
        },
      },
      driver,
    );

    await expect(service.getOrders('driver-1')).rejects.toThrow();
    await expect(service.getOrder('driver-1', 'order-1')).rejects.toThrow();
  });
});

describe('DriverService 수거 장소와 목록 판매점 ID', () => {
  // 판매점 이름·주소는 노출 판정이 읽은 stores/{storeId} 문서에서 온다.
  function pickupRecords(): Record<string, Data> {
    const records: Record<string, Data> = {
      'stores/pilot': {
        id: 'pilot',
        salesMode: 'round_direct',
        name: '  그린 화원  ',
        address: ' 서울시 중구 세종대로 1 ',
        ownerPhone: '010-9999-9999',
      },
      'stores/legacy': { id: 'legacy', salesMode: 'legacy', name: '레거시 꽃집', address: '   ' },
      'saleRounds/round-a': { id: 'round-a', storeId: 'pilot' },
      'orders/legacy-open': {
        storeId: 'legacy',
        deliveryMethod: 'hub',
        status: 'PREPARING',
        driverId: null,
        updatedAt: '2026-01-01T02:00:00.000Z',
      },
      'orders/pilot-delivering': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-a',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-1',
        updatedAt: '2026-01-01T03:00:00.000Z',
      },
      'orders/pilot-held': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-a',
        deliveryMethod: 'direct',
        status: 'DELIVERY_HELD',
        driverId: 'driver-1',
        updatedAt: '2026-01-01T04:00:00.000Z',
      },
      // storeId가 없는 이전 주문은 판매점을 읽지 않으므로 수거 장소가 없다.
      'orders/storeless': {
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
        updatedAt: '2026-01-01T05:00:00.000Z',
      },
    };
    for (let i = 0; i < 5; i += 1) {
      records[`orders/pilot-${i}`] = {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-a',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: i === 0 ? 'driver-1' : null,
        updatedAt: `2026-01-01T00:0${i}:00.000Z`,
      };
    }
    return records;
  }

  it('목록의 PREPARING 주문에만 공백을 걷어 낸 판매점 이름·주소를 싣고 판매점 문서는 요청당 한 번만 읽는다', async () => {
    const { service, firestore } = makeService(pickupRecords());

    const result = await service.getOrders('driver-1');
    const byId = Object.fromEntries(result.map((order) => [order.id, order]));

    expect(Object.keys(byId).sort()).toEqual(
      [
        'legacy-open',
        'pilot-0',
        'pilot-1',
        'pilot-2',
        'pilot-3',
        'pilot-4',
        'pilot-delivering',
        'pilot-held',
        'storeless',
      ].sort(),
    );
    for (let i = 0; i < 5; i += 1) {
      expect(byId[`pilot-${i}`]).toMatchObject({
        pickupStoreName: '그린 화원',
        pickupAddress: '서울시 중구 세종대로 1',
      });
    }
    // 공백뿐인 주소는 싣지 않고 이름만 싣는다.
    expect(byId['legacy-open']['pickupStoreName']).toBe('레거시 꽃집');
    expect(byId['legacy-open']).not.toHaveProperty('pickupAddress');
    for (const id of ['pilot-delivering', 'pilot-held', 'storeless']) {
      expect(byId[id]).not.toHaveProperty('pickupStoreName');
      expect(byId[id]).not.toHaveProperty('pickupAddress');
    }
    // 판매점의 다른 필드는 싣지 않는다.
    for (const order of result) expect(JSON.stringify(order)).not.toContain('010-9999-9999');

    const readCount = (path: string) =>
      firestore.doc.mock.calls.filter(([called]) => called === path).length;
    // 주문 7건이 같은 판매점이어도 노출 판정에서 1회만 읽고 수거 장소는 그 문서를 그대로 쓴다.
    expect(readCount('stores/pilot')).toBe(1);
    expect(readCount('stores/legacy')).toBe(1);
    expect(
      firestore.doc.mock.calls.filter(([called]) => String(called).startsWith('stores/')),
    ).toHaveLength(2);
  });

  it('목록 행에도 storeId를 싣는다(storeId가 없는 이전 주문은 비워 둔다)', async () => {
    const { service } = makeService(pickupRecords());

    const result = await service.getOrders('driver-1');
    const byId = Object.fromEntries(result.map((order) => [order.id, order]));

    expect(byId['pilot-0']['storeId']).toBe('pilot');
    expect(byId['pilot-delivering']['storeId']).toBe('pilot');
    expect(byId['legacy-open']['storeId']).toBe('legacy');
    expect(JSON.parse(JSON.stringify(byId['storeless']))).not.toHaveProperty('storeId');
    for (const order of result) expect(order).not.toHaveProperty('driverId');
  });

  it('상세도 PREPARING 주문에만 수거 장소를 싣고 노출 판정이 읽은 판매점 문서를 다시 읽지 않는다', async () => {
    const { service, firestore } = makeService(pickupRecords());
    const storeReads = () =>
      firestore.doc.mock.calls.filter(([called]) => String(called).startsWith('stores/')).length;

    await expect(service.getOrder('driver-1', 'pilot-0')).resolves.toMatchObject({
      storeId: 'pilot',
      pickupStoreName: '그린 화원',
      pickupAddress: '서울시 중구 세종대로 1',
    });
    expect(storeReads()).toBe(1);

    const legacy = await service.getOrder('driver-1', 'legacy-open');
    expect(legacy['pickupStoreName']).toBe('레거시 꽃집');
    expect(legacy).not.toHaveProperty('pickupAddress');

    for (const id of ['pilot-delivering', 'pilot-held', 'storeless']) {
      const order = await service.getOrder('driver-1', id);
      expect(order).not.toHaveProperty('pickupStoreName');
      expect(order).not.toHaveProperty('pickupAddress');
    }
  });

  it.each([
    ['이름·주소가 없는 판매점', {}],
    ['빈 문자열', { name: '', address: '' }],
    ['공백뿐인 값', { name: '  ', address: '\n\t' }],
    ['문자열이 아닌 값', { name: 123, address: { road: '세종대로' } }],
  ])('%s이면 수거 장소 필드를 싣지 않는다', async (_label, storeFields) => {
    const { service } = makeService({
      'stores/legacy': { id: 'legacy', salesMode: 'legacy', ...storeFields },
      'orders/open': {
        storeId: 'legacy',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
    });

    const [listed] = await service.getOrders('driver-1');
    const detail = await service.getOrder('driver-1', 'open');

    for (const order of [listed, detail]) {
      expect(order).not.toHaveProperty('pickupStoreName');
      expect(order).not.toHaveProperty('pickupAddress');
    }
  });
});

describe('DriverService 상품 파손 보류의 반납 장소', () => {
  // 상품 파손 보류는 재배송하지 않고 기사가 상품을 가게로 돌려준다(3차 재감사 S-11).
  function damagedRecords(): Record<string, Data> {
    const held = (reasonCode: string, extra: Data = {}): Data => ({
      storeId: 'pilot',
      schemaVersion: 2,
      roundId: 'round-a',
      deliveryMethod: 'direct',
      status: 'DELIVERY_HELD',
      driverId: 'driver-1',
      buyerName: '김그린',
      buyerPhone: '010-1111-1111',
      deliveryPhone: '010-3333-3333',
      sellerPhone: '02-555-6666',
      address: '서울시 중구 손님로 7 101동 202호',
      deliveryHold: {
        heldAt: '2026-11-13T01:00:00.000Z',
        reasonCode,
        reasonMessage: '사유 메모 010-7777-7777',
        customerResponsible: false,
        redeliveryFee: null,
        nextContactAt: null,
        nextDeliveryAt: null,
        resolvedAt: null,
      },
      ...extra,
    });
    return {
      'stores/pilot': {
        id: 'pilot',
        salesMode: 'round_direct',
        name: ' 그린 화원 ',
        address: ' 서울시 중구 세종대로 1 ',
        ownerPhone: '010-9999-9999',
        businessNumber: '123-45-67890',
      },
      'saleRounds/round-a': { id: 'round-a', storeId: 'pilot' },
      'orders/damaged': held('PRODUCT_DAMAGED'),
      'orders/refused': held('RECEIPT_REFUSED'),
      // 보류가 풀려 배송 중으로 돌아간 주문은 예전 보류 기록이 남아 있어도 반납 대상이 아니다.
      'orders/resumed': held('PRODUCT_DAMAGED', { status: 'DELIVERING' }),
      'orders/other-driver-damaged': held('PRODUCT_DAMAGED', { driverId: 'driver-2' }),
    };
  }

  it('상세는 상품 파손 보류에만 가게 이름·주소와 판매자 전화를 싣는다', async () => {
    const { service } = makeService(damagedRecords());

    const damaged = await service.getOrder('driver-1', 'damaged');
    expect(damaged).toMatchObject({
      pickupStoreName: '그린 화원',
      pickupAddress: '서울시 중구 세종대로 1',
      sellerPhone: '02-555-6666',
      // 손님 전화는 보류 단계 규칙 그대로다.
      buyerPhone: '010-3333-3333',
      deliveryHold: { reasonCode: 'PRODUCT_DAMAGED' },
    });

    for (const id of ['refused', 'resumed']) {
      const order = await service.getOrder('driver-1', id);
      expect(order).not.toHaveProperty('pickupStoreName');
      expect(order).not.toHaveProperty('pickupAddress');
      expect(order).not.toHaveProperty('sellerPhone');
    }
    // 판매점의 다른 필드(대표 전화·사업자 번호)는 싣지 않는다.
    const serialized = JSON.stringify(damaged);
    expect(serialized).not.toContain('010-9999-9999');
    expect(serialized).not.toContain('123-45-67890');
  });

  it('다른 기사의 상품 파손 보류는 보이지 않는다', async () => {
    const { service } = makeService(damagedRecords());

    await expect(service.getOrder('driver-1', 'other-driver-damaged')).rejects.toThrow();
    const listed = await service.getOrders('driver-1');
    expect(listed.map((order) => order.id)).not.toContain('other-driver-damaged');
  });

  it('목록은 보류 사유 코드와 반납 장소만 더 싣고 전화번호·보류 사유 글은 싣지 않는다', async () => {
    const { service } = makeService(damagedRecords());

    const listed = await service.getOrders('driver-1');
    const byId = Object.fromEntries(listed.map((order) => [order.id, order]));

    expect(byId['damaged']).toMatchObject({
      deliveryHoldReasonCode: 'PRODUCT_DAMAGED',
      pickupStoreName: '그린 화원',
      pickupAddress: '서울시 중구 세종대로 1',
    });
    expect(byId['refused']['deliveryHoldReasonCode']).toBe('RECEIPT_REFUSED');
    expect(byId['refused']).not.toHaveProperty('pickupStoreName');
    // 배송 중 주문에는 보류 사유 코드를 싣지 않는다.
    expect(byId['resumed']).not.toHaveProperty('deliveryHoldReasonCode');
    expect(byId['resumed']).not.toHaveProperty('pickupStoreName');
    for (const order of listed) {
      for (const field of ['sellerPhone', 'buyerPhone', 'deliveryPhone', 'deliveryHold']) {
        expect(order).not.toHaveProperty(field);
      }
      const serialized = JSON.stringify(order);
      expect(serialized).not.toContain('사유 메모');
      expect(serialized).not.toContain('010-9999-9999');
    }
  });
});

describe('DriverService 오늘 완료 요약', () => {
  // 서울 2026-11-11 00:30. 서울 오늘의 시작은 2026-11-10T15:00:00Z다.
  const AFTER_MIDNIGHT = '2026-11-10T15:30:00.000Z';
  // 서울 2026-11-10 23:30. 서울 오늘의 시작은 2026-11-09T15:00:00Z, 끝(제외)은 2026-11-10T15:00:00Z다.
  const BEFORE_MIDNIGHT = '2026-11-10T14:30:00.000Z';

  function summaryRecords(): Record<string, Data> {
    const mine = { driverId: 'driver-1', deliveryMethod: 'direct', storeId: 'pilot' };
    return {
      // 서울 자정 정각에 완료.
      'orders/at-midnight': {
        ...mine,
        status: 'DELIVERED',
        deliveredAt: timestamp('2026-11-10T15:00:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:00:00.000Z'),
      },
      // 서울 자정 1초 전 완료.
      'orders/before-midnight': {
        ...mine,
        status: 'DELIVERED',
        deliveredAt: timestamp('2026-11-10T14:59:59.000Z'),
        updatedAt: timestamp('2026-11-10T14:59:59.000Z'),
      },
      // 자정 전에 완료하고 자정 뒤 고객이 리뷰(구매 확정)해 updatedAt만 다음 날인 주문.
      'orders/reviewed-after-midnight-delivered-before': {
        ...mine,
        status: 'REVIEWED',
        deliveredAt: timestamp('2026-11-10T14:59:59.000Z'),
        updatedAt: timestamp('2026-11-10T15:10:00.000Z'),
      },
      // 자정 뒤 완료하고 리뷰돼 상태가 DELIVERED 뒤로 넘어간 주문.
      'orders/reviewed-today': {
        ...mine,
        status: 'REVIEWED',
        deliveredAt: timestamp('2026-11-10T15:05:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:20:00.000Z'),
      },
      // 자정 뒤 완료한 뒤 배송 후 환불로 취소된 주문.
      'orders/refunded-after-delivery-today': {
        ...mine,
        status: 'CANCELLED',
        deliveredAt: timestamp('2026-11-10T15:06:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:25:00.000Z'),
      },
      // deliveredAt을 쓰기 전에 완료된 주문: DELIVERED에 머물면 updatedAt을 완료 시각으로 본다.
      'orders/previous-delivered-today': {
        ...mine,
        status: 'DELIVERED',
        updatedAt: timestamp('2026-11-10T15:07:00.000Z'),
      },
      // deliveredAt 없이 리뷰·취소로 넘어간 주문은 완료 시각을 알 수 없어 세지 않는다.
      'orders/previous-reviewed-today': {
        ...mine,
        status: 'REVIEWED',
        updatedAt: timestamp('2026-11-10T15:08:00.000Z'),
      },
      'orders/cancelled-before-delivery': {
        ...mine,
        status: 'CANCELLED',
        updatedAt: timestamp('2026-11-10T15:09:00.000Z'),
      },
      'orders/mine-delivering': {
        ...mine,
        status: 'DELIVERING',
        updatedAt: timestamp('2026-11-10T15:11:00.000Z'),
      },
      // 배송 보류 뒤 고객 사유로 종결된 주문: 배송 완료가 아니므로(deliveredAt 없음) 세지 않는다.
      'orders/closed-undelivered-today': {
        ...mine,
        status: 'CLOSED_UNDELIVERED',
        updatedAt: timestamp('2026-11-10T15:15:00.000Z'),
      },
      'orders/mine-hub-arrived': {
        ...mine,
        deliveryMethod: 'hub',
        status: 'HUB_ARRIVED',
        updatedAt: timestamp('2026-11-10T15:12:00.000Z'),
      },
      // 다른 기사·미배정 주문은 같은 날 완료여도 세지 않는다.
      'orders/other-driver-today': {
        ...mine,
        driverId: 'driver-2',
        status: 'DELIVERED',
        deliveredAt: timestamp('2026-11-10T15:13:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:13:00.000Z'),
      },
      'orders/parcel-today': {
        storeId: 'pilot',
        deliveryMethod: 'parcel',
        status: 'DELIVERED',
        deliveredAt: timestamp('2026-11-10T15:14:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:14:00.000Z'),
      },
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it('서울 자정 직후에는 자정 이후 완료만 세고, 리뷰·환불로 상태가 넘어간 오늘 완료도 센다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service } = makeService(summaryRecords());

    // at-midnight, reviewed-today, refunded-after-delivery-today, previous-delivered-today.
    await expect(service.getSummary('driver-1')).resolves.toEqual({ completedToday: 4 });
  });

  it('서울 자정 직전에는 그날 완료만 세고 자정 정각 이후 완료는 세지 않는다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(BEFORE_MIDNIGHT));
    const { service } = makeService(summaryRecords());

    // before-midnight, reviewed-after-midnight-delivered-before 두 건(완료 시각이 서울 11-10).
    await expect(service.getSummary('driver-1')).resolves.toEqual({ completedToday: 2 });
  });

  it('응답은 완료 수만 싣는다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service } = makeService(summaryRecords());

    const summary = await service.getSummary('driver-1');

    expect(Object.keys(summary)).toEqual(['completedToday']);
  });

  it('기존 (status, driverId, updatedAt) 인덱스 모양의 쿼리 하나로 본인·오늘 바뀐 완료 계열 주문만 읽는다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const records = summaryRecords();
    // 지난 기록이 많아도 오늘 바뀌지 않은 주문은 읽지 않는다.
    for (let i = 0; i < 20; i += 1) {
      records[`orders/history-${String(i).padStart(2, '0')}`] = {
        driverId: 'driver-1',
        deliveryMethod: 'direct',
        status: i % 2 === 0 ? 'DELIVERED' : 'REVIEWED',
        deliveredAt: timestamp('2026-10-01T03:00:00.000Z'),
        updatedAt: timestamp('2026-10-02T03:00:00.000Z'),
      };
    }
    const { service, executedQueries, reads } = makeService(records);

    await expect(service.getSummary('driver-1')).resolves.toEqual({ completedToday: 4 });

    expect(executedQueries).toHaveLength(1);
    const [filters] = executedQueries;
    expect(filters.map(([field, operator]) => [field, operator])).toEqual([
      ['status', 'in'],
      ['driverId', '=='],
      ['updatedAt', '>='],
    ]);
    expect(filters[0][2]).toEqual(['DELIVERED', 'REVIEWED', 'CANCELLED']);
    expect(filters[1][2]).toBe('driver-1');
    expect(comparableMillis(filters[2][2])).toBe(Date.parse('2026-11-10T15:00:00.000Z'));
    // 오늘 바뀐 본인 DELIVERED·REVIEWED·CANCELLED 주문 7건만 읽는다.
    expect(reads.orderDocs).toBe(7);
  });

  it.each([
    ['승인 필드가 정확한 true가 아님', { role: 'driver', driverApproved: false }],
    ['정지됨', { role: 'driver', driverApproved: true, suspended: true }],
    ['driver 역할이 아님', { role: 'consumer', driverApproved: true }],
  ])('%s이면 요약을 거부하고 주문을 읽지 않는다', async (_label, driver) => {
    const { service, executedQueries } = makeService(summaryRecords(), driver);

    await expect(service.getSummary('driver-1')).rejects.toThrow();
    expect(executedQueries).toHaveLength(0);
  });

  it.each([
    ['서울 자정 직후', AFTER_MIDNIGHT, 4],
    ['서울 자정 직전', BEFORE_MIDNIGHT, 2],
  ])('%s 완료 내역 길이는 같은 fixture의 completedToday와 같다', async (_label, now, count) => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
    const { service } = makeService(summaryRecords());

    const { completedToday } = await service.getSummary('driver-1');
    const { orders } = await service.getCompletedToday('driver-1');

    expect(completedToday).toBe(count);
    expect(orders).toHaveLength(completedToday);
  });
});

describe('DriverService 오늘 완료 내역·사진 다시 보기', () => {
  // 서울 2026-11-11 00:30. 서울 오늘은 [2026-11-10T15:00Z, 2026-11-11T15:00Z)다.
  const AFTER_MIDNIGHT = '2026-11-10T15:30:00.000Z';
  // 서울 2026-11-10 23:30. 서울 오늘은 [2026-11-09T15:00Z, 2026-11-10T15:00Z)다.
  const BEFORE_MIDNIGHT = '2026-11-10T14:30:00.000Z';
  const LEGACY_PHOTO_URL =
    'https://firebasestorage.googleapis.com/v0/b/bucket/o/legacy.jpg?alt=media&token=legacy-token';

  // 노출하면 안 되는 손님·결제·좌표·판매점 필드를 모두 채운 회차 직배송 주문.
  const roundDirect = (overrides: Data): Data => ({
    driverId: 'driver-1',
    storeId: 'pilot',
    schemaVersion: 2,
    roundId: 'round-1',
    deliveryMethod: 'direct',
    orderNumber: 'GH-0001',
    userId: 'consumer-1',
    buyerName: '김손님',
    buyerPhone: '010-1111-2222',
    deliveryPhone: '010-3333-4444',
    sellerPhone: '02-555-6666',
    requestNote: '받는 분 이영희, 문 앞에 두세요',
    lat: 37.5,
    lng: 127.0,
    totalAmount: 33000,
    deliveryFee: 3000,
    paymentKey: 'pay-key-1',
    payment: { method: 'card', amount: 33000, approvedAt: '2026-11-09T01:00:00.000Z' },
    redeliveryPayment: { required: false },
    address: '서울시 강남구 테헤란로 1 101동 1001호',
    deliveryAddress: {
      address: '서울시 강남구 테헤란로 1',
      addressDetail: '101동 1001호',
      zipCode: '06000',
      recipientName: '이영희',
      phone: '010-7777-8888',
      lat: 37.5,
      lng: 127.0,
    },
    productName: '몬스테라',
    quantity: 3,
    orderItems: [
      { productId: 'p-1', productName: '몬스테라', quantity: 2, unitPrice: 10000 },
      { productId: 'p-2', productName: '스투키', quantity: 1, unitPrice: 10000 },
    ],
    ...overrides,
  });

  function completedRecords(): Record<string, Data> {
    return {
      // 회차 직배송 사진이 있는 오늘 완료.
      'orders/round-photo-delivered': roundDirect({
        status: 'DELIVERED',
        deliveryPhotoIds: ['photo-1'],
        deliveredAt: timestamp('2026-11-10T15:05:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:05:00.000Z'),
      }),
      // 오늘 완료한 뒤 배송 후 환불로 취소된 회차 직배송 주문(사진은 그대로 보인다).
      'orders/round-photo-cancelled': roundDirect({
        status: 'CANCELLED',
        deliveryPhotoIds: ['photo-2'],
        deliveredAt: timestamp('2026-11-10T15:06:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:20:00.000Z'),
      }),
      // 오늘 완료 후 리뷰된 회차 직배송 주문(사진 없음).
      'orders/round-reviewed-no-photo': roundDirect({
        status: 'REVIEWED',
        deliveryPhotoIds: [],
        deliveredAt: timestamp('2026-11-10T15:04:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:21:00.000Z'),
      }),
      // 이전 방식 사진(토큰 다운로드 URL)만 있는 주문. 사진으로 치지 않고 URL도 싣지 않는다.
      'orders/legacy-with-url': {
        driverId: 'driver-1',
        storeId: 'legacy-store',
        deliveryMethod: 'direct',
        status: 'DELIVERED',
        buyerName: '박손님',
        address: '서울시 마포구 1',
        productName: '산세베리아',
        quantity: 1,
        deliveryPhotoUrl: LEGACY_PHOTO_URL,
        deliveryPhotoIds: ['legacy-photo'],
        deliveredAt: timestamp('2026-11-10T15:07:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:07:00.000Z'),
      },
      // deliveredAt을 쓰기 전에 완료돼 DELIVERED에 머문 주문은 updatedAt을 완료 시각으로 본다.
      'orders/previous-delivered-today': {
        driverId: 'driver-1',
        storeId: 'legacy-store',
        deliveryMethod: 'direct',
        status: 'DELIVERED',
        deliveryAddress: { address: '서울시 용산구 2', zipCode: '04000' },
        productName: '고무나무',
        quantity: 2,
        updatedAt: timestamp('2026-11-10T15:08:00.000Z'),
      },
      // 서울 어제(자정 1초 전) 완료, 자정 뒤 리뷰된 회차 직배송 사진 주문.
      'orders/yesterday-photo': roundDirect({
        status: 'REVIEWED',
        deliveryPhotoIds: ['photo-yesterday'],
        deliveredAt: timestamp('2026-11-10T14:59:59.000Z'),
        updatedAt: timestamp('2026-11-10T15:10:00.000Z'),
      }),
      // 다른 기사의 오늘 완료 사진 주문.
      'orders/other-driver-photo': roundDirect({
        driverId: 'driver-2',
        status: 'DELIVERED',
        deliveryPhotoIds: ['photo-other'],
        deliveredAt: timestamp('2026-11-10T15:09:00.000Z'),
        updatedAt: timestamp('2026-11-10T15:09:00.000Z'),
      }),
      // 배송 전 취소·배송 중 주문은 완료 내역이 아니다.
      'orders/cancelled-before-delivery': roundDirect({
        status: 'CANCELLED',
        deliveryPhotoIds: ['photo-cancelled'],
        updatedAt: timestamp('2026-11-10T15:11:00.000Z'),
      }),
      'orders/mine-delivering': roundDirect({
        status: 'DELIVERING',
        updatedAt: timestamp('2026-11-10T15:12:00.000Z'),
      }),
    };
  }

  const SIGNED = {
    url: 'https://storage.googleapis.com/bucket/deliveryPhotos/x.jpg?X-Goog-Signature=sig',
    expiresAt: '2026-11-10T15:45:00.000Z',
  };

  function makeCompletedService(
    records: Record<string, Data>,
    driver: Data = { role: 'driver', driverApproved: true },
  ) {
    const { firestore, executedQueries } = makeFirestore(records);
    records['users/driver-1'] = { id: 'driver-1', ...driver };
    const storage = { createDeliveryPhotoReadUrl: jest.fn().mockResolvedValue(SIGNED) };
    const service = new DriverService(
      firestore as never,
      new OrdersQueryService(firestore as never),
      new DriverOrderScopeService(firestore as never),
      storage as never,
    );
    return { service, storage, firestore, executedQueries };
  }

  function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
      for (const item of value) collectKeys(item, keys);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, nested] of Object.entries(value)) {
        keys.add(key);
        collectKeys(nested, keys);
      }
    }
    return keys;
  }

  async function caught(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('예외가 나야 합니다.');
      },
      (error: unknown) => error as { getStatus: () => number; getResponse: () => unknown },
    );
  }

  afterEach(() => jest.restoreAllMocks());

  it('서울 자정 직후에는 오늘 완료만 완료 시각 내림차순으로 싣고 요약 수와 길이가 같다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service } = makeCompletedService(completedRecords());

    const result = await service.getCompletedToday('driver-1');
    const summary = await service.getSummary('driver-1');

    expect(result.date).toBe('2026-11-11');
    expect(result.orders.map((order) => [order.id, order.status, order.deliveredAt])).toEqual([
      ['previous-delivered-today', 'DELIVERED', '2026-11-10T15:08:00.000Z'],
      ['legacy-with-url', 'DELIVERED', '2026-11-10T15:07:00.000Z'],
      ['round-photo-cancelled', 'CANCELLED', '2026-11-10T15:06:00.000Z'],
      ['round-photo-delivered', 'DELIVERED', '2026-11-10T15:05:00.000Z'],
      ['round-reviewed-no-photo', 'REVIEWED', '2026-11-10T15:04:00.000Z'],
    ]);
    expect(result.orders).toHaveLength(summary.completedToday);
  });

  it('서울 자정 직전에는 그날 완료만 싣고 날짜도 그날이다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(BEFORE_MIDNIGHT));
    const { service } = makeCompletedService(completedRecords());

    const result = await service.getCompletedToday('driver-1');
    const summary = await service.getSummary('driver-1');

    expect(result.date).toBe('2026-11-10');
    expect(result.orders.map((order) => order.id)).toEqual(['yesterday-photo']);
    expect(result.orders).toHaveLength(summary.completedToday);
  });

  it('요약과 같은 (status, driverId, updatedAt) 인덱스 모양의 쿼리 하나로 읽는다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service, executedQueries } = makeCompletedService(completedRecords());

    await service.getCompletedToday('driver-1');

    expect(executedQueries).toHaveLength(1);
    expect(executedQueries[0].map(([field, operator]) => [field, operator])).toEqual([
      ['status', 'in'],
      ['driverId', '=='],
      ['updatedAt', '>='],
    ]);
  });

  it('허용 목록 필드만 싣고 손님·결제·좌표·판매점 정보는 어느 깊이에도 없다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service } = makeCompletedService(completedRecords());

    const result = await service.getCompletedToday('driver-1');
    const keys = collectKeys(result.orders);

    const allowed = new Set([
      'id',
      'status',
      'deliveredAt',
      'address',
      'deliveryAddress',
      'addressDetail',
      'productName',
      'quantity',
      'items',
      'hasPhoto',
    ]);
    expect([...keys].filter((key) => !allowed.has(key))).toEqual([]);
    const serialized = JSON.stringify(result);
    for (const secret of [
      '김손님',
      '이영희',
      '010-',
      '02-555',
      '받는 분',
      '37.5',
      'round-1',
      'GH-0001',
      'consumer-1',
      'pilot',
      'pay-key-1',
      '06000',
      'legacy-token',
      'photo-1',
    ]) {
      expect(serialized).not.toContain(secret);
    }

    const delivered = result.orders.find((order) => order.id === 'round-photo-delivered');
    expect(delivered).toEqual({
      id: 'round-photo-delivered',
      status: 'DELIVERED',
      deliveredAt: '2026-11-10T15:05:00.000Z',
      address: '서울시 강남구 테헤란로 1 101동 1001호',
      deliveryAddress: { address: '서울시 강남구 테헤란로 1', addressDetail: '101동 1001호' },
      productName: '몬스테라',
      quantity: 3,
      items: [
        { productName: '몬스테라', quantity: 2 },
        { productName: '스투키', quantity: 1 },
      ],
      hasPhoto: true,
    });
    // 주문 문서에 전체 주소가 없으면 deliveryAddress.address로 대신하고 우편번호는 싣지 않는다.
    expect(result.orders.find((order) => order.id === 'previous-delivered-today')).toEqual({
      id: 'previous-delivered-today',
      status: 'DELIVERED',
      deliveredAt: '2026-11-10T15:08:00.000Z',
      address: '서울시 용산구 2',
      deliveryAddress: { address: '서울시 용산구 2' },
      productName: '고무나무',
      quantity: 2,
      hasPhoto: false,
    });
  });

  it('회차 직배송 사진이 있는 행만 hasPhoto이고, 이전 방식 사진 URL은 사진으로 치지 않고 싣지 않는다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service } = makeCompletedService(completedRecords());

    const result = await service.getCompletedToday('driver-1');

    expect(Object.fromEntries(result.orders.map((order) => [order.id, order.hasPhoto]))).toEqual({
      'previous-delivered-today': false,
      'legacy-with-url': false,
      'round-photo-cancelled': true,
      'round-photo-delivered': true,
      'round-reviewed-no-photo': false,
    });
    const legacy = result.orders.find((order) => order.id === 'legacy-with-url');
    expect(legacy).not.toHaveProperty('deliveryPhotoUrl');
    expect(JSON.stringify(result)).not.toContain(LEGACY_PHOTO_URL);
  });

  it.each([
    ['round-photo-delivered', 'photo-1'],
    ['round-photo-cancelled', 'photo-2'],
  ])(
    '오늘 완료한 본인 회차 직배송 주문 %s는 첫 사진의 서명 URL을 준다',
    async (orderId, photoId) => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
      const { service, storage } = makeCompletedService(completedRecords());

      await expect(service.getCompletedTodayPhoto('driver-1', orderId)).resolves.toEqual(SIGNED);

      expect(storage.createDeliveryPhotoReadUrl).toHaveBeenCalledTimes(1);
      expect(storage.createDeliveryPhotoReadUrl).toHaveBeenCalledWith({
        storeId: 'pilot',
        orderId,
        photoId,
        requesterId: 'driver-1',
        requesterRole: 'driver',
      });
    },
  );

  it('여러 사진이 연결돼 있으면 첫 사진을 쓴다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const records = completedRecords();
    records['orders/round-photo-delivered']['deliveryPhotoIds'] = ['photo-first', 'photo-second'];
    const { service, storage } = makeCompletedService(records);

    await service.getCompletedTodayPhoto('driver-1', 'round-photo-delivered');

    expect(storage.createDeliveryPhotoReadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: 'photo-first' }),
    );
  });

  it.each([
    ['다른 기사 주문', 'other-driver-photo'],
    ['서울 어제 완료', 'yesterday-photo'],
    ['사진 없음', 'round-reviewed-no-photo'],
    ['이전 방식 사진 URL만 있음', 'legacy-with-url'],
    ['배송 전 취소', 'cancelled-before-delivery'],
    ['배송 중', 'mine-delivering'],
    ['없는 주문', 'missing-order'],
  ])('%s이면 같은 404로 답하고 서명하지 않는다', async (_label, orderId) => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service, storage } = makeCompletedService(completedRecords());

    const error = await caught(service.getCompletedTodayPhoto('driver-1', orderId));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ statusCode: 404, code: DRIVER_ORDER_NOT_FOUND }),
    );
    expect(storage.createDeliveryPhotoReadUrl).not.toHaveBeenCalled();
  });

  it('다른 기사 주문의 404 응답은 사진 없는 본인 주문의 응답과 구분되지 않는다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service } = makeCompletedService(completedRecords());

    const other = await caught(service.getCompletedTodayPhoto('driver-1', 'other-driver-photo'));
    const mineNoPhoto = await caught(
      service.getCompletedTodayPhoto('driver-1', 'round-reviewed-no-photo'),
    );

    expect(other.getResponse()).toEqual(mineNoPhoto.getResponse());
  });

  it.each([
    ['승인 필드가 정확한 true가 아님', { role: 'driver', driverApproved: false }],
    ['정지됨', { role: 'driver', driverApproved: true, suspended: true }],
    ['driver 역할이 아님', { role: 'consumer', driverApproved: true }],
  ])('%s이면 완료 내역·사진을 403으로 거부하고 주문을 읽지 않는다', async (_label, driver) => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(AFTER_MIDNIGHT));
    const { service, storage, firestore, executedQueries } = makeCompletedService(
      completedRecords(),
      driver,
    );

    for (const call of [
      () => service.getCompletedToday('driver-1'),
      () => service.getCompletedTodayPhoto('driver-1', 'round-photo-delivered'),
    ]) {
      const error = await caught(call());
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({ statusCode: 403, code: DRIVER_ORDER_AUTHORITY_DENIED }),
      );
    }
    expect(executedQueries).toHaveLength(0);
    const readPaths = firestore.doc.mock.calls.map(([path]) => path);
    expect(readPaths.filter((path) => path.startsWith('orders/'))).toEqual([]);
    expect(storage.createDeliveryPhotoReadUrl).not.toHaveBeenCalled();
  });
});
