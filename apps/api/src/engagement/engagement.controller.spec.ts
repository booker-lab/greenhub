import 'reflect-metadata';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BadRequestException,
  ForbiddenException,
  type INestApplication,
  Logger,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
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
import {
  REVIEW_PHOTO_UPLOAD_CONCURRENCY,
  ReviewPhotoUploadSlotsInterceptor,
} from './review-photo-upload-slots.interceptor';
import { ReviewsService } from './reviews.service';

const PHOTO_PATH = '/reviews/order-1_product-1/photos';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const BOUNDARY = 'greenhub-review-photo-boundary';
const THROTTLE_MESSAGE = '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';

interface PartialUpload {
  /** 본문을 다 보내기 전에 받은 응답. 서버가 본문을 끝까지 기다리면 시간 초과로 실패한다. */
  response: Promise<{ status: number; body: Record<string, unknown> }>;
  abort: () => void;
}

async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('조건을 기다리다 시간이 지났습니다.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('후기 사진·삭제·숨기기 HTTP 경계', () => {
  let app: INestApplication;
  const reviews = {
    assertCanAddPhotos: jest.fn(),
    addReviewPhotos: jest.fn(),
    deleteOwnReview: jest.fn(),
    hideReview: jest.fn(),
    unhideReview: jest.fn(),
    listHiddenReviews: jest.fn(),
  };
  const engagement = {
    setPartnerInquiryContacted: jest.fn(),
    deletePartnerInquiry: jest.fn(),
  };

  // 테스트가 연 원시 연결. app.close()가 끝나지 않은 업로드를 기다리지 않게 먼저 끊는다.
  const openUploads: PartialUpload[] = [];

  beforeEach(async () => {
    reviews.assertCanAddPhotos.mockResolvedValue(undefined);
    reviews.addReviewPhotos.mockResolvedValue({ id: 'order-1_product-1', hidden: false });
    reviews.deleteOwnReview.mockResolvedValue({ id: 'order-1_product-1', deleted: true });
    reviews.hideReview.mockResolvedValue({ id: 'order-1_product-1', hidden: true });
    reviews.unhideReview.mockResolvedValue({ id: 'order-1_product-1', hidden: false });
    reviews.listHiddenReviews.mockResolvedValue({ reviews: [], hasMore: false, limit: 200 });
    engagement.setPartnerInquiryContacted.mockResolvedValue({ id: 'inq-1', contactedAt: null });
    engagement.deletePartnerInquiry.mockResolvedValue({ id: 'inq-1' });
    const module = await Test.createTestingModule({
      controllers: [MyEngagementController, SellerEngagementController, AdminEngagementController],
      providers: [
        { provide: ReviewsService, useValue: reviews },
        { provide: EngagementService, useValue: engagement },
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
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    for (const upload of openUploads.splice(0)) upload.abort();
    await app.close();
    jest.clearAllMocks();
  });

  const uploadSlots = () => app.get(ReviewPhotoUploadSlotsInterceptor, { strict: false }).slots;

  /**
   * 사진 파트를 4MB로 알리고 앞 64KB만 보낸 채 연결을 열어 둔다.
   * multer가 본문을 읽기 시작했다면 나머지를 기다리느라 응답하지 못한다.
   */
  const startPartialUpload = (path: string, role: string): PartialUpload => {
    const head = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="photos"; filename="a.jpg"\r\n` +
        'Content-Type: image/jpeg\r\n\r\n',
    );
    const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
    const declaredFileBytes = 4 * 1024 * 1024;
    const { port } = app.getHttpServer().address() as AddressInfo;
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path,
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        'content-length': String(head.length + declaredFileBytes + tail.length),
        'x-test-role': role,
      },
    });
    req.on('error', () => undefined);
    let timer: NodeJS.Timeout | undefined;
    const response = new Promise<{ status: number; body: Record<string, unknown> }>(
      (resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('본문을 다 보내기 전에는 응답이 오지 않았습니다.')),
          1500,
        );
        req.on('response', (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            clearTimeout(timer);
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} });
          });
        });
      },
    );
    // 응답을 기다리지 않고 끊는 업로드의 시간 초과가 테스트 밖에서 터지지 않게 한다.
    response.catch(() => undefined);
    req.write(head);
    req.write(Buffer.alloc(64 * 1024, 0xff));
    const upload = {
      response,
      abort: () => {
        clearTimeout(timer);
        req.destroy();
      },
    };
    openUploads.push(upload);
    return upload;
  };

  const post = (path: string, role: string) =>
    request(app.getHttpServer()).post(path).set('x-test-role', role);

  it('고객이 올린 사진 3장까지는 서비스로 전달된다', async () => {
    const response = await post(PHOTO_PATH, 'consumer')
      .attach('photos', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photos', JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .attach('photos', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(reviews.assertCanAddPhotos).toHaveBeenCalledWith('order-1_product-1', 'consumer-1');
    expect(reviews.addReviewPhotos).toHaveBeenCalledWith(
      'order-1_product-1',
      'consumer-1',
      expect.arrayContaining([expect.objectContaining({ mimetype: 'image/jpeg' })]),
    );
    expect(reviews.addReviewPhotos.mock.calls[0][2]).toHaveLength(3);
    // 본문을 받기 전 확인이 먼저, 저장은 그 뒤다.
    expect(reviews.assertCanAddPhotos.mock.invocationCallOrder[0]).toBeLessThan(
      reviews.addReviewPhotos.mock.invocationCallOrder[0],
    );
    expect(uploadSlots().inFlight).toBe(0);
  });

  it.each([
    ['남의 후기', new ForbiddenException('내가 쓴 후기에만 사진을 올릴 수 있습니다.'), 403],
    ['없는 후기', new NotFoundException('후기를 찾을 수 없습니다.'), 404],
    [
      '사진 자리가 다 찬 후기',
      new BadRequestException('사진은 후기 하나에 3장까지 올릴 수 있어요.'),
      400,
    ],
    ['숨긴 후기', new BadRequestException('숨겨진 후기에는 사진을 더할 수 없습니다.'), 400],
  ])(
    '%s에는 multipart 본문을 받기 전에 서비스와 같은 오류로 거절한다',
    async (_case, error, status) => {
      reviews.assertCanAddPhotos.mockRejectedValue(error);
      // 서비스 안에서만 막던 예전 구조라면 본문을 다 받은 뒤 여기서 같은 오류가 났다.
      reviews.addReviewPhotos.mockRejectedValue(error);

      const partial = startPartialUpload(PHOTO_PATH, 'consumer');
      const early = await partial.response;
      expect(early.status).toBe(status);
      expect(early.body).toMatchObject({ statusCode: status, message: error.message });

      // multer가 파싱했다면 400(사진 4장 초과)이 났을 본문도 가드에서 먼저 거절된다.
      const parsedWouldFail = await post(PHOTO_PATH, 'consumer')
        .attach('photos', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .attach('photos', JPEG, { filename: 'b.jpg', contentType: 'image/jpeg' })
        .attach('photos', JPEG, { filename: 'c.jpg', contentType: 'image/jpeg' })
        .attach('photos', JPEG, { filename: 'd.jpg', contentType: 'image/jpeg' });
      expect(parsedWouldFail.status).toBe(status);

      expect(reviews.assertCanAddPhotos).toHaveBeenCalledWith('order-1_product-1', 'consumer-1');
      expect(reviews.addReviewPhotos).not.toHaveBeenCalled();
      expect(uploadSlots().inFlight).toBe(0);
    },
  );

  it('동시 업로드가 상한을 넘으면 본문을 읽기 전에 429로 거절하고, 끝나면 자리를 돌려준다', async () => {
    const finish: Array<() => void> = [];
    reviews.addReviewPhotos.mockImplementation(
      () =>
        new Promise((resolve) =>
          finish.push(() => resolve({ id: 'order-1_product-1', hidden: false })),
        ),
    );
    const send = () =>
      post(PHOTO_PATH, 'consumer')
        .attach('photos', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .then((response) => response);

    const running = Array.from({ length: REVIEW_PHOTO_UPLOAD_CONCURRENCY }, send);
    await waitUntil(() => finish.length === REVIEW_PHOTO_UPLOAD_CONCURRENCY);
    expect(uploadSlots().inFlight).toBe(REVIEW_PHOTO_UPLOAD_CONCURRENCY);

    const over = await startPartialUpload(PHOTO_PATH, 'consumer').response;
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ statusCode: 429, message: THROTTLE_MESSAGE });
    expect(reviews.addReviewPhotos).toHaveBeenCalledTimes(REVIEW_PHOTO_UPLOAD_CONCURRENCY);

    for (const done of finish.splice(0)) done();
    for (const response of await Promise.all(running)) expect(response.status).toBe(200);
    expect(uploadSlots().inFlight).toBe(0);

    reviews.addReviewPhotos.mockResolvedValue({ id: 'order-1_product-1', hidden: false });
    expect((await send()).status).toBe(200);
    expect(uploadSlots().inFlight).toBe(0);
  });

  it('본문을 올리다 연결이 끊긴 업로드도 자리를 돌려준다', async () => {
    // 끊긴 업로드는 multer의 'Request aborted' 오류로 끝나며 Nest가 오류 로그를 남긴다(기존 동작).
    const quiet = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const uploads = Array.from({ length: REVIEW_PHOTO_UPLOAD_CONCURRENCY }, () =>
        startPartialUpload(PHOTO_PATH, 'consumer'),
      );
      await waitUntil(() => uploadSlots().inFlight === REVIEW_PHOTO_UPLOAD_CONCURRENCY);
      expect((await startPartialUpload(PHOTO_PATH, 'consumer').response).status).toBe(429);

      for (const upload of uploads) upload.abort();
      await waitUntil(() => uploadSlots().inFlight === 0);
      expect(reviews.addReviewPhotos).not.toHaveBeenCalled();

      const after = await post(PHOTO_PATH, 'consumer').attach('photos', JPEG, {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      });
      expect(after.status).toBe(200);
    } finally {
      quiet.mockRestore();
    }
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
    expect(reviews.assertCanAddPhotos).not.toHaveBeenCalled();
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

  it('입점 문의 연락함 표시·삭제는 관리자만, 연락함 값은 true/false만 받는다', async () => {
    const contactedPath = '/admin/partner-inquiries/inq-1/contacted';
    const put = (role: string) => request(app.getHttpServer()).put(contactedPath).set('x-test-role', role);
    const remove = (role: string) =>
      request(app.getHttpServer()).delete('/admin/partner-inquiries/inq-1').set('x-test-role', role);

    for (const role of ['seller', 'consumer', 'driver']) {
      expect((await put(role).send({ contacted: true })).status).toBe(403);
      expect((await remove(role)).status).toBe(403);
    }
    expect(engagement.setPartnerInquiryContacted).not.toHaveBeenCalled();
    expect(engagement.deletePartnerInquiry).not.toHaveBeenCalled();

    for (const body of [{}, { contacted: 'yes' }, { contacted: true, note: 'x' }]) {
      expect((await put('admin').send(body)).status).toBe(400);
    }
    expect((await put('admin').send({ contacted: true })).status).toBe(200);
    expect(engagement.setPartnerInquiryContacted).toHaveBeenCalledWith('inq-1', true, 'admin-1');
    expect((await remove('admin')).status).toBe(200);
    expect(engagement.deletePartnerInquiry).toHaveBeenCalledWith('inq-1', 'admin-1');
  });
});
