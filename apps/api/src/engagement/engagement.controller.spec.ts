import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import {
  AdminEngagementController,
  MyEngagementController,
  SellerEngagementController,
} from './engagement.controller';
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
    listHiddenReviews: jest.fn(),
  };

  beforeEach(async () => {
    reviews.addReviewPhotos.mockResolvedValue({ id: 'order-1_product-1', hidden: false });
    reviews.deleteOwnReview.mockResolvedValue({ id: 'order-1_product-1', deleted: true });
    reviews.hideReview.mockResolvedValue({ id: 'order-1_product-1', hidden: true });
    reviews.unhideReview.mockResolvedValue({ id: 'order-1_product-1', hidden: false });
    reviews.listHiddenReviews.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      controllers: [MyEngagementController, SellerEngagementController, AdminEngagementController],
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

  it('숨기기는 판매자·관리자만, 사유는 목록의 분류만 받고 설명은 선택이다', async () => {
    const hidePath = '/reviews/order-1_product-1/hide';
    expect((await post(hidePath, 'consumer').send({ reasonCode: 'spam' })).status).toBe(403);
    for (const body of [
      {},
      { reasonCode: 'low-rating' },
      { reasonCode: '광고·스팸' },
      { reason: '광고' },
      { reasonCode: 'spam', note: 'x'.repeat(201) },
    ]) {
      expect((await post(hidePath, 'seller').send(body)).status).toBe(400);
    }
    expect(reviews.hideReview).not.toHaveBeenCalled();

    const hide = await post(hidePath, 'seller').send({ reasonCode: 'spam', note: '홍보 링크' });
    expect(hide.status).toBe(200);
    expect(reviews.hideReview).toHaveBeenCalledWith(
      'order-1_product-1',
      { userId: 'seller-1', role: 'seller' },
      'spam',
      '홍보 링크',
    );
    const withoutNote = await post(hidePath, 'admin').send({ reasonCode: 'privacy' });
    expect(withoutNote.status).toBe(200);
    expect(reviews.hideReview).toHaveBeenLastCalledWith(
      'order-1_product-1',
      { userId: 'admin-1', role: 'admin' },
      'privacy',
      undefined,
    );
  });

  it('숨김 해제와 숨긴 후기 목록은 관리자만 쓸 수 있다(판매자 403)', async () => {
    const unhidePath = '/admin/reviews/order-1_product-1/unhide';
    expect((await post(unhidePath, 'seller').send({})).status).toBe(403);
    expect((await post('/reviews/order-1_product-1/unhide', 'seller').send({})).status).toBe(404);
    const sellerList = await request(app.getHttpServer())
      .get('/admin/reviews/hidden')
      .set('x-test-role', 'seller');
    expect(sellerList.status).toBe(403);
    expect(reviews.unhideReview).not.toHaveBeenCalled();
    expect(reviews.listHiddenReviews).not.toHaveBeenCalled();

    const unhide = await post(unhidePath, 'admin').send({});
    expect(unhide.status).toBe(200);
    expect(reviews.unhideReview).toHaveBeenCalledWith(
      'order-1_product-1',
      { userId: 'admin-1', role: 'admin' },
      undefined,
    );
    const adminList = await request(app.getHttpServer())
      .get('/admin/reviews/hidden')
      .set('x-test-role', 'admin');
    expect(adminList.status).toBe(200);
    expect(reviews.listHiddenReviews).toHaveBeenCalledTimes(1);
  });
});
