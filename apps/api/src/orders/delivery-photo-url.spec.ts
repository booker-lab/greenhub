import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  isLegacyDeliveryPhotoUrl,
  isLegacyDeliveryPhotoUrlForOrder,
  LEGACY_DELIVERY_PHOTO_URL_MESSAGE,
} from './delivery-photo-url';
import { DriverOrderScopeService } from './driver-order-scope.service';
import { AttachDeliveryPhotoDto, UpdateStatusDto } from './dto/update-status.dto';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { createSettledOrdersLifecycle } from '../../test/helpers/settled-orders-lifecycle';

type Data = Record<string, unknown>;

const productionEnv = {
  FIREBASE_PROJECT_ID: 'green-e4fe3',
  FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com',
};
const localEnv = {
  FIREBASE_PROJECT_ID: 'demo-greenhub',
  FIREBASE_STORAGE_BUCKET: 'demo-greenhub.appspot.com',
  GREENHUB_LOCAL_RUNTIME: 'true',
  NODE_ENV: 'development',
};

// unit-test-setup.ts가 고정한 bucket
const UNIT_BUCKET = 'greenhub-api-unit-test.appspot.com';

function downloadUrl(
  bucket: string,
  objectPath: string,
  host = 'https://firebasestorage.googleapis.com',
) {
  return `${host}/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=8df4ed49-2dab-4687-b13c-70094f5cf24e`;
}

describe('거점 배송 사진 URL 판정', () => {
  it('기사 앱 getDownloadURL 결과(자사 bucket, deliveryPhotos/<orderId>_<ms>.jpg)를 허용한다', () => {
    const url = downloadUrl('green-e4fe3.appspot.com', 'deliveryPhotos/order-1_1760000000000.jpg');
    expect(isLegacyDeliveryPhotoUrl(url, productionEnv)).toBe(true);
    expect(isLegacyDeliveryPhotoUrlForOrder(url, 'order-1', productionEnv)).toBe(true);
  });

  it('project 기본 bucket의 firebasestorage.app 이름과 GCS 공개 URL도 허용한다', () => {
    expect(
      isLegacyDeliveryPhotoUrlForOrder(
        downloadUrl('green-e4fe3.firebasestorage.app', 'deliveryPhotos/order-1_1.jpg'),
        'order-1',
        productionEnv,
      ),
    ).toBe(true);
    expect(
      isLegacyDeliveryPhotoUrlForOrder(
        'https://storage.googleapis.com/green-e4fe3.appspot.com/deliveryPhotos/order-1_1.jpg',
        'order-1',
        productionEnv,
      ),
    ).toBe(true);
  });

  it('밑줄이 들어간 orderId도 마지막 밑줄 앞까지를 주문으로 본다', () => {
    const url = downloadUrl('green-e4fe3.appspot.com', 'deliveryPhotos/a_b_1760000000000.jpg');
    expect(isLegacyDeliveryPhotoUrlForOrder(url, 'a_b', productionEnv)).toBe(true);
    expect(isLegacyDeliveryPhotoUrlForOrder(url, 'a', productionEnv)).toBe(false);
  });

  it('다른 bucket, 다른 호스트, 경로 prefix 불일치, 다른 orderId를 거부한다', () => {
    const rejected = [
      downloadUrl('other-project.appspot.com', 'deliveryPhotos/order-1_1.jpg'),
      downloadUrl(
        'green-e4fe3.appspot.com',
        'deliveryPhotos/order-1_1.jpg',
        'https://evil.example',
      ),
      'https://example.com/deliveryPhotos/order-1_1.jpg',
      downloadUrl('green-e4fe3.appspot.com', 'products/store-1/order-1_1.jpg'),
      downloadUrl('green-e4fe3.appspot.com', 'logos/order-1_1.jpg'),
      downloadUrl('green-e4fe3.appspot.com', 'deliveryPhotos/order-1/photo-1.jpg'),
      downloadUrl('green-e4fe3.appspot.com', 'deliveryPhotos/order-1_1.png'),
      downloadUrl('green-e4fe3.appspot.com', 'deliveryPhotos/order-1_abc.jpg'),
      downloadUrl('green-e4fe3.appspot.com', 'deliveryPhotos/../order-1_1.jpg'),
      `http://firebasestorage.googleapis.com/v0/b/green-e4fe3.appspot.com/o/${encodeURIComponent('deliveryPhotos/order-1_1.jpg')}`,
      '',
      'not a url',
    ];
    for (const url of rejected) {
      expect(isLegacyDeliveryPhotoUrlForOrder(url, 'order-1', productionEnv)).toBe(false);
    }
    expect(
      isLegacyDeliveryPhotoUrlForOrder(
        downloadUrl('green-e4fe3.appspot.com', 'deliveryPhotos/order-2_1.jpg'),
        'order-1',
        productionEnv,
      ),
    ).toBe(false);
  });

  it('Storage emulator URL은 local runtime에서만 허용한다', () => {
    const url = downloadUrl(
      'demo-greenhub.appspot.com',
      'deliveryPhotos/order-1_1.jpg',
      'http://127.0.0.1:9199',
    );
    expect(isLegacyDeliveryPhotoUrlForOrder(url, 'order-1', localEnv)).toBe(true);
    expect(
      isLegacyDeliveryPhotoUrlForOrder(
        downloadUrl(
          'demo-greenhub.appspot.com',
          'deliveryPhotos/order-1_1.jpg',
          'http://localhost:9199',
        ),
        'order-1',
        localEnv,
      ),
    ).toBe(true);
    expect(
      isLegacyDeliveryPhotoUrlForOrder(url, 'order-1', {
        ...localEnv,
        GREENHUB_LOCAL_RUNTIME: undefined,
      }),
    ).toBe(false);
    expect(
      isLegacyDeliveryPhotoUrlForOrder(url, 'order-1', { ...localEnv, NODE_ENV: 'production' }),
    ).toBe(false);
  });

  it('bucket 구성이 없으면 아무 URL도 허용하지 않는다', () => {
    expect(
      isLegacyDeliveryPhotoUrl(
        downloadUrl('green-e4fe3.appspot.com', 'deliveryPhotos/order-1_1.jpg'),
        {},
      ),
    ).toBe(false);
  });
});

describe('배송 사진 DTO 검증', () => {
  const validUrl = downloadUrl(UNIT_BUCKET, 'deliveryPhotos/order-1_1760000000000.jpg');

  it('자사 bucket의 거점 배송 사진 URL은 통과한다', async () => {
    await expect(
      validate(plainToInstance(AttachDeliveryPhotoDto, { photoUrl: validUrl })),
    ).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(UpdateStatusDto, { status: 'HUB_ARRIVED', photoUrl: validUrl })),
    ).resolves.toHaveLength(0);
  });

  it('외부 URL은 두 DTO 모두 거부한다', async () => {
    const external = 'https://example.com/photo.jpg';
    const attachErrors = await validate(
      plainToInstance(AttachDeliveryPhotoDto, { photoUrl: external }),
    );
    expect(attachErrors[0]?.constraints).toEqual({
      isLegacyDeliveryPhotoUrl: LEGACY_DELIVERY_PHOTO_URL_MESSAGE,
    });
    const statusErrors = await validate(
      plainToInstance(UpdateStatusDto, { status: 'HUB_ARRIVED', photoUrl: external }),
    );
    expect(statusErrors.map((error) => error.property)).toEqual(['photoUrl']);
  });

  it('photoUrl이 없는 상태 변경은 그대로 통과한다', async () => {
    await expect(
      validate(plainToInstance(UpdateStatusDto, { status: 'DELIVERING' })),
    ).resolves.toHaveLength(0);
  });
});

function makeFirestore(order: Data) {
  const records = new Map<string, Data>([['orders/order-1', order]]);
  records.set('stores/store-1', { id: 'store-1', salesMode: 'legacy' });
  records.set('users/driver-1', { id: 'driver-1', role: 'driver', driverApproved: true });
  const snapshot = (data: Data | null) => ({ exists: data !== null, data: () => data });
  const firestore = {
    doc: (path: string) => ({
      path,
      get: jest.fn(async () => snapshot(records.get(path) ?? null)),
    }),
    runTransaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) => {
      const pending = new Map<string, Data>();
      const transaction = {
        get: jest.fn(async (ref: { path: string }) =>
          snapshot(pending.get(ref.path) ?? records.get(ref.path) ?? null),
        ),
        update: jest.fn((ref: { path: string }, data: Data) => {
          pending.set(ref.path, { ...(records.get(ref.path) ?? {}), ...data });
        }),
      };
      const value = await callback(transaction);
      for (const [path, data] of pending) records.set(path, data);
      return value;
    }),
    Timestamp: { now: jest.fn(() => new Date('2026-10-12T00:00:00.000Z')) },
  };
  return { firestore, records };
}

function makeService(firestore: unknown) {
  const driverScope = new DriverOrderScopeService(firestore as never);
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  const payments = { processRefundByOrderId: jest.fn() };
  const settlements = { createSettlement: jest.fn(), cancelSettlement: jest.fn() };
  const capacity = { releaseReservationInTransaction: jest.fn() };
  const roundLifecycle = new RoundOrderLifecycleService(
    firestore as never,
    payments as never,
    settlements as never,
    capacity as never,
    driverScope,
  );
  return createSettledOrdersLifecycle(
    firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle,
    driverScope,
  );
}

describe('거점 주문 배송 사진 저장', () => {
  const hubOrder = (): Data => ({
    storeId: 'store-1',
    userId: 'consumer-1',
    status: 'DELIVERING',
    deliveryMethod: 'hub',
    // 거점 주문은 생성 때 픽업 코드를 받는다(거점 도착 전이는 픽업 코드가 있어야 한다).
    pickupCode: '123456',
    driverId: 'driver-1',
  });

  it('기사 앱이 올린 이 주문의 사진 URL은 저장하고 거점 도착으로 전환한다', async () => {
    const { firestore, records } = makeFirestore(hubOrder());
    const service = makeService(firestore);
    const photoUrl = downloadUrl(UNIT_BUCKET, 'deliveryPhotos/order-1_1760000000000.jpg');

    await expect(
      service.updateStatus(
        'store-1',
        'order-1',
        'driver-1',
        { status: 'HUB_ARRIVED', photoUrl },
        'driver',
      ),
    ).resolves.toMatchObject({ orderId: 'order-1', status: 'HUB_ARRIVED' });
    expect(records.get('orders/order-1')).toMatchObject({
      status: 'HUB_ARRIVED',
      deliveryPhotoUrl: photoUrl,
    });
  });

  it.each([
    ['다른 주문의 사진', downloadUrl(UNIT_BUCKET, 'deliveryPhotos/order-2_1760000000000.jpg')],
    ['다른 bucket', downloadUrl('other.appspot.com', 'deliveryPhotos/order-1_1.jpg')],
    ['외부 호스트', 'https://example.com/deliveryPhotos/order-1_1.jpg'],
    ['다른 경로', downloadUrl(UNIT_BUCKET, 'products/store-1/order-1_1.jpg')],
  ])('%s URL은 400으로 거부하고 주문을 바꾸지 않는다', async (_label, photoUrl) => {
    const { firestore, records } = makeFirestore(hubOrder());
    const service = makeService(firestore);

    await expect(
      service.updateStatus(
        'store-1',
        'order-1',
        'driver-1',
        { status: 'HUB_ARRIVED', photoUrl },
        'driver',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(records.get('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(records.get('orders/order-1')).not.toHaveProperty('deliveryPhotoUrl');
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('판매자·관리자 경로(배송 사진 연결)에서도 외부 URL로 배송 완료되지 않는다', async () => {
    const { firestore, records } = makeFirestore({ ...hubOrder(), status: 'HUB_ARRIVED' });
    const service = makeService(firestore);

    await expect(
      service.updateStatus(
        'store-1',
        'order-1',
        'admin-1',
        { status: 'DELIVERED', photoUrl: 'https://example.com/photo.jpg' },
        'admin',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(records.get('orders/order-1')).toMatchObject({ status: 'HUB_ARRIVED' });
  });
});
