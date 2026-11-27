// 사진은 연결됐는데 완료 전이가 빠진 주문이 보류되면, 보류 전 사진이 재배송 회차의 완료 근거로 남지 않아야 한다.
// (a) 재배송 뒤 상세의 완료 PATCH가 보류 전 사진으로 완료하지 못한다.
// (b) 재배송 때 새로 찍은 사진은 "이미 다른 사진이 연결됨"으로 막히지 않고 완료된다.
// 보류 전이(판매자·기사, 회차·레거시 경로)는 같은 트랜잭션에서 연결 사진을 감사 필드로 옮기고,
// Storage 객체와 보관 기록은 남긴다(보관 기간 파기가 맡는다).

import { createHash } from 'node:crypto';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { createSettledOrdersLifecycle } from '../../test/helpers/settled-orders-lifecycle';
import { RetentionService } from '../retention/retention.service';
import { DeliveryPhotosService } from './delivery-photos.service';
import { readHttpExceptionBody } from './driver-order-error';
import { DriverOrderScopeService } from './driver-order-scope.service';
import { OrderCapacityService } from './order-capacity.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

type Data = Record<string, any>;

const ORDER_PATH = 'orders/order-1';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);

const holdInput = {
  reasonCode: 'ACCESS_UNAVAILABLE',
  reasonMessage: '공동현관 출입이 안 돼요.',
  customerResponsible: false,
  redeliveryFee: null,
  nextContactAt: null,
  nextDeliveryAt: null,
};

function photoIdFor(key: string): string {
  return createHash('sha256').update(`order-1:${key}`).digest('hex').slice(0, 32);
}

function roundOrder(overrides: Data = {}): Data {
  return {
    id: 'order-1',
    storeId: 'store-round',
    userId: 'consumer-1',
    saleType: 'normal',
    status: 'DELIVERING',
    schemaVersion: 2,
    roundId: 'round-1',
    reservationId: 'reservation-1',
    orderItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
    deliveryMethod: 'direct',
    driverId: 'driver-1',
    totalAmount: 50000,
    ...overrides,
  };
}

function makeContext(order: Data) {
  const memory = createInMemoryFirestore({
    'stores/store-round': { id: 'store-round', ownerId: 'seller-1', salesMode: 'round_direct' },
    'users/driver-1': { id: 'driver-1', role: 'driver', driverApproved: true },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-round',
      status: 'OPEN',
      schedule: { orderCloseAt: '2026-11-01T00:00:00.000+09:00' },
      counters: {
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 1,
        orderedItemQuantity: 1,
        heldOrderCount: 0,
      },
    },
    [ORDER_PATH]: order,
  });
  const firestore = memory.firestore as never;
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  const payments = {
    processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue({ unsettledCount: 0 }),
  };
  const settlements = {
    createSettlement: jest.fn().mockResolvedValue(undefined),
    cancelSettlement: jest.fn().mockResolvedValue(undefined),
  };
  const driverScope = new DriverOrderScopeService(firestore);
  const capacity = new OrderCapacityService(firestore);
  const roundLifecycle = new RoundOrderLifecycleService(
    firestore,
    payments as never,
    settlements as never,
    capacity,
    driverScope,
  );
  const lifecycle = createSettledOrdersLifecycle(
    firestore,
    notifications as never,
    payments as never,
    settlements as never,
    capacity,
    roundLifecycle,
    driverScope,
  );
  const storedPaths = new Set<string>();
  const storage = {
    uploadDeliveryPhoto: jest.fn(async (input: Data) => {
      const path = `deliveryPhotos/${input.orderId}/${input.photoId}.jpg`;
      const created = !storedPaths.has(path);
      storedPaths.add(path);
      return { orderId: input.orderId, photoId: input.photoId, path, created };
    }),
    reconcileDeliveryPhoto: jest.fn(),
    deleteObject: jest.fn(async (path: string) => {
      storedPaths.delete(path);
    }),
  };
  const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue' }) };
  const retention = new RetentionService(firestore, storage, issueWriter as never);
  const photos = new DeliveryPhotosService(
    firestore,
    storage as never,
    retention,
    lifecycle,
    driverScope,
    issueWriter as never,
  );
  const update = (requesterId: string, role: string, dto: Data) =>
    lifecycle.updateStatus('store-round', 'order-1', requesterId, dto as never, role);
  const upload = (key: string, extra: Data = {}) =>
    photos.uploadAndComplete({
      storeId: 'store-round',
      orderId: 'order-1',
      requesterId: 'driver-1',
      requesterRole: 'driver',
      idempotencyKey: key,
      content: jpeg,
      contentType: 'image/jpeg',
      ...extra,
    });
  return { memory, lifecycle, settlements, notifications, storage, storedPaths, update, upload };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('거절되어야 하는 요청이 성공했습니다.');
}

/** 사진은 연결됐지만 DELIVERED 전이가 빠진 상태를 실제 업로드 경로로 만든다. */
async function attachWithoutCompletion(context: ReturnType<typeof makeContext>, key: string) {
  jest
    .spyOn(context.lifecycle, 'updateStatus')
    .mockRejectedValueOnce(new Error('완료 전이 직전 연결 끊김'));
  await expect(context.upload(key)).rejects.toThrow('완료 전이 직전 연결 끊김');
  expect(context.memory.read(ORDER_PATH)).toMatchObject({
    status: 'DELIVERING',
    deliveryPhotoIds: [photoIdFor(key)],
  });
}

describe('완료 전이가 빠진 사진 연결 뒤 보류 → 재배송', () => {
  it.each([
    ['판매자', 'seller-1', 'seller'],
    ['기사', 'driver-1', 'driver'],
  ])('%s 보류는 보류 전 사진을 연결에서 떼어 감사 필드로 옮기고 보관 기록은 남긴다', async (_label, requesterId, role) => {
    const context = makeContext(roundOrder());
    await attachWithoutCompletion(context, 'old-photo-key-1');
    const oldPhotoId = photoIdFor('old-photo-key-1');

    await context.update(requesterId, role, { status: 'DELIVERY_HELD', deliveryHold: holdInput });

    const held = context.memory.read(ORDER_PATH)!;
    expect(held['status']).toBe('DELIVERY_HELD');
    expect(held['deliveryPhotoIds']).toEqual([]);
    expect(held['detachedDeliveryPhotos']).toEqual([
      { photoId: oldPhotoId, detachedAt: held['deliveryHold']['heldAt'], reason: 'HOLD' },
    ]);
    // Storage 객체는 지우지 않고, 보관 기록(파기 기준)은 주문 필드와 무관하게 남는다.
    expect(context.storage.deleteObject).not.toHaveBeenCalled();
    expect(context.storedPaths.has(`deliveryPhotos/order-1/${oldPhotoId}.jpg`)).toBe(true);
    expect(context.memory.read(`deliveryPhotoRecords/order-1:${oldPhotoId}`)).toMatchObject({
      orderId: 'order-1',
      photoId: oldPhotoId,
      purpose: 'DELIVERY_PHOTO',
      storagePath: `deliveryPhotos/order-1/${oldPhotoId}.jpg`,
    });
    // 보류된 주문은 완료 후속효과 재조정으로 완료되지 않는다.
    await expect(
      context.lifecycle.reconcileDeliveryCompletion('store-round', 'order-1'),
    ).rejects.toThrow('배송 완료 주문만');
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();
  });

  it('(a) 재배송 뒤 상세의 완료 PATCH는 보류 전 사진으로 완료하지 못한다', async () => {
    const context = makeContext(roundOrder());
    await attachWithoutCompletion(context, 'old-photo-key-1');
    await context.update('seller-1', 'seller', { status: 'DELIVERY_HELD', deliveryHold: holdInput });
    await context.update('driver-1', 'driver', { status: 'DELIVERING' });

    const error = await rejection(context.update('driver-1', 'driver', { status: 'DELIVERED' }));

    expect(readHttpExceptionBody(error)).toMatchObject({
      message: '배송 사진 연결 후에만 배송을 완료할 수 있습니다.',
    });
    expect(context.memory.read(ORDER_PATH)?.['status']).toBe('DELIVERING');
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();
    expect(context.notifications.sendToUser).not.toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_DELIVERED',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('(b) 재배송 때 새로 찍은 사진은 충돌 없이 연결되고 완료된다', async () => {
    const context = makeContext(roundOrder());
    await attachWithoutCompletion(context, 'old-photo-key-1');
    await context.update('driver-1', 'driver', { status: 'DELIVERY_HELD', deliveryHold: holdInput });
    await context.update('driver-1', 'driver', { status: 'DELIVERING' });
    const heldAt = context.memory.read(ORDER_PATH)!['deliveryHold']['heldAt'];

    await expect(
      context.upload('new-photo-key-2', { expectedHoldAt: heldAt }),
    ).resolves.toEqual({
      orderId: 'order-1',
      photoId: photoIdFor('new-photo-key-2'),
      status: 'DELIVERED',
    });

    const delivered = context.memory.read(ORDER_PATH)!;
    expect(delivered).toMatchObject({
      status: 'DELIVERED',
      deliveryPhotoIds: [photoIdFor('new-photo-key-2')],
      deliveryPhotoAttachedHoldAt: heldAt,
      detachedDeliveryPhotos: [
        expect.objectContaining({ photoId: photoIdFor('old-photo-key-1'), reason: 'HOLD' }),
      ],
    });
    expect(context.settlements.createSettlement).toHaveBeenCalledTimes(1);
  });

  it('보류 표시를 보내지 않는 예전 앱이 보류 전 사진을 다시 보내도 재배송을 완료하지 않는다', async () => {
    const context = makeContext(roundOrder());
    await attachWithoutCompletion(context, 'old-photo-key-1');
    await context.update('seller-1', 'seller', { status: 'DELIVERY_HELD', deliveryHold: holdInput });
    await context.update('driver-1', 'driver', { status: 'DELIVERING' });

    const error = await rejection(context.upload('old-photo-key-1'));

    expect(readHttpExceptionBody(error)).toMatchObject({
      statusCode: 409,
      code: 'DELIVERY_PHOTO_STALE_HOLD',
    });
    expect(context.memory.read(ORDER_PATH)).toMatchObject({
      status: 'DELIVERING',
      deliveryPhotoIds: [],
    });
    // Storage에 쓰기 전에 거절해 보상 삭제·재조정 이슈가 생기지 않는다.
    expect(context.storage.uploadDeliveryPhoto).toHaveBeenCalledTimes(1);
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();
  });

  it('수거 전(PREPARING) 재보류도 연결 사진을 뗀다', async () => {
    const context = makeContext(
      roundOrder({ status: 'PREPARING', deliveryPhotoIds: ['photo-before-hold'] }),
    );

    await context.update('seller-1', 'seller', { status: 'DELIVERY_HELD', deliveryHold: holdInput });

    expect(context.memory.read(ORDER_PATH)).toMatchObject({
      status: 'DELIVERY_HELD',
      deliveryPhotoIds: [],
      detachedDeliveryPhotos: [expect.objectContaining({ photoId: 'photo-before-hold' })],
    });
  });

  it('연결 시점 보류 표시가 없는 예전 연결은 보류 이력이 있으면 완료 근거로 인정하지 않는다', async () => {
    // 이 수정 전에 보류를 거쳐 사진이 남은 채 다시 배송 중인 주문(배포 전 데이터).
    const context = makeContext(
      roundOrder({
        deliveryPhotoIds: ['photo-before-hold'],
        deliveryHold: {
          ...holdInput,
          heldAt: '2026-11-12T01:00:00.000Z',
          resolvedAt: '2026-11-12T02:00:00.000Z',
        },
        deliveryHoldCount: 1,
      }),
    );

    const error = await rejection(context.update('driver-1', 'driver', { status: 'DELIVERED' }));

    expect(readHttpExceptionBody(error)).toMatchObject({
      message: '배송 사진 연결 후에만 배송을 완료할 수 있습니다.',
    });
    expect(context.memory.read(ORDER_PATH)?.['status']).toBe('DELIVERING');
  });

  it('보류 이력이 없는 예전 연결은 그대로 완료 근거로 인정한다', async () => {
    const context = makeContext(roundOrder({ deliveryPhotoIds: ['photo-current'] }));

    await expect(
      context.update('driver-1', 'driver', { status: 'DELIVERED' }),
    ).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERED' });
  });
});

describe('레거시(회차 아님) 보류 경로도 연결 사진을 뗀다', () => {
  function legacyOrder(overrides: Data = {}): Data {
    return {
      id: 'order-1',
      storeId: 'store-round',
      userId: 'consumer-1',
      saleType: 'normal',
      status: 'DELIVERING',
      deliveryMethod: 'direct',
      driverId: 'driver-1',
      deliveryPhotoIds: ['legacy-photo'],
      ...overrides,
    };
  }

  it('판매자 보류', async () => {
    const context = makeContext(legacyOrder());
    // 레거시 판매점 범위.
    context.memory.records.set('stores/store-round', {
      id: 'store-round',
      ownerId: 'seller-1',
      salesMode: 'legacy',
    });

    await context.update('seller-1', 'seller', { status: 'DELIVERY_HELD', deliveryHold: holdInput });

    expect(context.memory.read(ORDER_PATH)).toMatchObject({
      status: 'DELIVERY_HELD',
      deliveryPhotoIds: [],
      detachedDeliveryPhotos: [
        expect.objectContaining({ photoId: 'legacy-photo', reason: 'HOLD' }),
      ],
    });
  });

  it('기사 보류', async () => {
    const context = makeContext(legacyOrder());
    context.memory.records.set('stores/store-round', {
      id: 'store-round',
      ownerId: 'seller-1',
      salesMode: 'legacy',
    });

    await context.update('driver-1', 'driver', { status: 'DELIVERY_HELD', deliveryHold: holdInput });

    expect(context.memory.read(ORDER_PATH)).toMatchObject({
      status: 'DELIVERY_HELD',
      deliveryPhotoIds: [],
      detachedDeliveryPhotos: [expect.objectContaining({ photoId: 'legacy-photo' })],
    });
  });

  it('회차 연결이 남은 레거시 판매자 보류(보류 집계 경로)', async () => {
    const context = makeContext(legacyOrder({ roundId: 'round-1' }));
    context.memory.records.set('stores/store-round', {
      id: 'store-round',
      ownerId: 'seller-1',
      salesMode: 'legacy',
    });

    await context.update('seller-1', 'seller', { status: 'DELIVERY_HELD', deliveryHold: holdInput });

    expect(context.memory.read(ORDER_PATH)).toMatchObject({
      status: 'DELIVERY_HELD',
      deliveryPhotoIds: [],
      detachedDeliveryPhotos: [expect.objectContaining({ photoId: 'legacy-photo' })],
    });
  });

  it('완료된 주문의 사진은 건드리지 않는다(보류 전이가 아닌 경로)', async () => {
    const context = makeContext(roundOrder({ status: 'DELIVERED', deliveryPhotoIds: ['done'] }));

    await rejection(
      context.update('seller-1', 'seller', { status: 'DELIVERY_HELD', deliveryHold: holdInput }),
    );

    expect(context.memory.read(ORDER_PATH)).toMatchObject({
      status: 'DELIVERED',
      deliveryPhotoIds: ['done'],
    });
  });
});
