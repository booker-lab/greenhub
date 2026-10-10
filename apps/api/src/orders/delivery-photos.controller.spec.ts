import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DeliveryPhotosController } from './delivery-photos.controller';
import { DeliveryPhotosService } from './delivery-photos.service';

const UPLOAD_PATH = '/stores/store-1/orders/order-1/delivery-photos';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const IDEMPOTENCY_KEY = 'upload-key-0001';

describe('회차 직배송 사진 컨트롤러 계약', () => {
  it('인증 없는 업로드와 조회를 막는 JWT 가드를 컨트롤러 전체에 적용한다', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DeliveryPhotosController) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });

  it('업로드에만 Driver 역할 가드를 걸고, 조회는 서비스의 주문별 권한 판정에 맡긴다', () => {
    const upload = DeliveryPhotosController.prototype.upload;
    const readUrl = DeliveryPhotosController.prototype.createReadUrl;

    expect(Reflect.getMetadata(GUARDS_METADATA, upload)).toEqual([RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, upload)).toEqual(['driver']);
    expect(Reflect.getMetadata(GUARDS_METADATA, readUrl)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, readUrl)).toBeUndefined();
  });
});

describe('회차 직배송 사진 업로드 HTTP 경계', () => {
  let app: INestApplication;
  const deliveryPhotos = {
    uploadAndComplete: jest.fn(),
    createReadUrl: jest.fn(),
  };

  beforeEach(async () => {
    deliveryPhotos.uploadAndComplete.mockResolvedValue({
      orderId: 'order-1',
      photoId: 'photo-1',
      status: 'DELIVERED',
    });
    const module = await Test.createTestingModule({
      controllers: [DeliveryPhotosController],
      providers: [{ provide: DeliveryPhotosService, useValue: deliveryPhotos }, RolesGuard],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.use(
      (
        req: { headers: Record<string, string | undefined>; user?: unknown },
        _res: unknown,
        next: () => void,
      ) => {
        const role = req.headers['x-test-role'];
        if (role) req.user = { sub: `${role}-1`, role };
        next();
      },
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  function upload(role: string) {
    return request(app.getHttpServer()).post(UPLOAD_PATH).set('x-test-role', role);
  }

  it('Driver의 사진 1장과 멱등 키 업로드는 서비스로 전달된다', async () => {
    const response = await upload('driver')
      .field('idempotencyKey', IDEMPOTENCY_KEY)
      .attach('photo', JPEG, { filename: 'delivery.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(deliveryPhotos.uploadAndComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        orderId: 'order-1',
        requesterId: 'driver-1',
        requesterRole: 'driver',
        idempotencyKey: IDEMPOTENCY_KEY,
        contentType: 'image/jpeg',
      }),
    );
  });

  it.each([
    'consumer',
    'seller',
    'admin',
  ])('%s 역할 업로드는 multipart 파싱 전에 403으로 거절된다', async (role) => {
    const response = await upload(role)
      .field('idempotencyKey', IDEMPOTENCY_KEY)
      .attach('photo', JPEG, { filename: 'delivery.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(403);
    expect(deliveryPhotos.uploadAndComplete).not.toHaveBeenCalled();
  });

  it.each([
    [
      '추가 텍스트 필드',
      (req: request.Test) =>
        req
          .field('idempotencyKey', IDEMPOTENCY_KEY)
          .field('extra', 'x')
          .attach('photo', JPEG, { filename: 'delivery.jpg', contentType: 'image/jpeg' }),
    ],
    [
      '중첩 필드명',
      (req: request.Test) =>
        req
          .field('idempotencyKey[a]', IDEMPOTENCY_KEY)
          .attach('photo', JPEG, { filename: 'delivery.jpg', contentType: 'image/jpeg' }),
    ],
    [
      '너무 긴 필드 값',
      (req: request.Test) =>
        req
          .field('idempotencyKey', 'k'.repeat(1024))
          .attach('photo', JPEG, { filename: 'delivery.jpg', contentType: 'image/jpeg' }),
    ],
    [
      '두 번째 파일',
      (req: request.Test) =>
        req
          .field('idempotencyKey', IDEMPOTENCY_KEY)
          .attach('photo', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
          .attach('photo', JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' }),
    ],
  ])('Driver 업로드라도 %s가 있으면 400이고 서비스에 도달하지 않는다', async (_label, build) => {
    const response = await build(upload('driver'));

    expect(response.status).toBe(400);
    expect(deliveryPhotos.uploadAndComplete).not.toHaveBeenCalled();
  });

  it('사진 크기 한도를 넘으면 413이고 서비스에 도달하지 않는다', async () => {
    const response = await upload('driver')
      .field('idempotencyKey', IDEMPOTENCY_KEY)
      .attach('photo', Buffer.alloc(5 * 1024 * 1024 + 1, 0xff), {
        filename: 'delivery.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(413);
    expect(deliveryPhotos.uploadAndComplete).not.toHaveBeenCalled();
  });
});
