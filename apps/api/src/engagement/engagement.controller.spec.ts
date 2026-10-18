import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { MyEngagementController, SellerEngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';
import { ReviewsService } from './reviews.service';

const PHOTO_PATH = '/reviews/order-1_product-1/photos';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

describe('후기 사진·삭제·숨기기 HTTP 경계', () => {
  let app: INestApplication;
  const reviews = {
    addReviewPhotos: jest.fn(),
    deleteOwnReview: jest.fn(),
    hideReview: jest.fn(),
    unhideReview: jest.fn(),
  };

  beforeEach(async () => {
    reviews.addReviewPhotos.mockResolvedValue({ id: 'order-1_product-1', hidden: false });
    reviews.deleteOwnReview.mockResolvedValue({ id: 'order-1_product-1', deleted: true });
    reviews.hideReview.mockResolvedValue({ id: 'order-1_product-1', hidden: true });
    reviews.unhideReview.mockResolvedValue({ id: 'order-1_product-1', hidden: false });
    const module = await Test.createTestingModule({
      controllers: [MyEngagementController, SellerEngagementController],
      providers: [
        { provide: ReviewsService, useValue: reviews },
        { provide: EngagementService, useValue: {} },
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
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

  const post = (path: string, role: string) =>
    request(app.getHttpServer()).post(path).set('x-test-role', role);

  it('고객이 올린 사진 3장까지는 서비스로 전달된다', async () => {
    const response = await post(PHOTO_PATH, 'consumer')
      .attach('photos', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photos', JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .attach('photos', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(reviews.addReviewPhotos).toHaveBeenCalledWith(
      'order-1_product-1',
      'consumer-1',
      expect.arrayContaining([expect.objectContaining({ mimetype: 'image/jpeg' })]),
    );
    expect(reviews.addReviewPhotos.mock.calls[0][2]).toHaveLength(3);
  });

  it('네 번째 사진·텍스트 필드·다른 이름의 파일은 파싱 단계에서 거절한다', async () => {
    const fourth = await post(PHOTO_PATH, 'consumer')
      .attach('photos', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photos', JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .attach('photos', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' })
      .attach('photos', JPEG, { filename: 'd.jpg', contentType: 'image/jpeg' });
    const field = await post(PHOTO_PATH, 'consumer')
      .field('extra', 'x')
      .attach('photos', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    const otherName = await post(PHOTO_PATH, 'consumer').attach('photo', JPEG, {
      filename: 'a.jpg',
      contentType: 'image/jpeg',
    });

    for (const response of [fourth, field, otherName]) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect(reviews.addReviewPhotos).not.toHaveBeenCalled();
  });

  it.each(['seller', 'driver'])('%s 역할의 사진 업로드·후기 삭제는 403이다', async (role) => {
    const upload = await post(PHOTO_PATH, role).attach('photos', JPEG, {
      filename: 'a.jpg',
      contentType: 'image/jpeg',
    });
    const remove = await request(app.getHttpServer())
      .delete('/reviews/order-1_product-1')
      .set('x-test-role', role);
    expect(upload.status).toBe(403);
    expect(remove.status).toBe(403);
    expect(reviews.addReviewPhotos).not.toHaveBeenCalled();
    expect(reviews.deleteOwnReview).not.toHaveBeenCalled();
  });

  it('고객 삭제는 본인 id로 서비스에 맡긴다', async () => {
    const response = await request(app.getHttpServer())
      .delete('/reviews/order-1_product-1')
      .set('x-test-role', 'consumer');
    expect(response.status).toBe(200);
    expect(reviews.deleteOwnReview).toHaveBeenCalledWith('order-1_product-1', 'consumer-1');
  });

  it('숨기기는 판매자·관리자만, 사유가 꼭 있어야 한다', async () => {
    expect(
      (await post('/reviews/order-1_product-1/hide', 'consumer').send({ reason: '광고' })).status,
    ).toBe(403);
    expect((await post('/reviews/order-1_product-1/hide', 'seller').send({})).status).toBe(400);
    expect(
      (await post('/reviews/order-1_product-1/hide', 'seller').send({ reason: 'x'.repeat(201) }))
        .status,
    ).toBe(400);
    expect(reviews.hideReview).not.toHaveBeenCalled();

    const hide = await post('/reviews/order-1_product-1/hide', 'seller').send({ reason: '광고' });
    expect(hide.status).toBe(200);
    expect(reviews.hideReview).toHaveBeenCalledWith(
      'order-1_product-1',
      { userId: 'seller-1', role: 'seller' },
      '광고',
    );

    const unhide = await post('/reviews/order-1_product-1/unhide', 'admin').send({});
    expect(unhide.status).toBe(200);
    expect(reviews.unhideReview).toHaveBeenCalledWith(
      'order-1_product-1',
      { userId: 'admin-1', role: 'admin' },
      undefined,
    );
  });
});
