import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { createMemoryFirestore } from '../common/testing/memory-firestore';
import {
  AdminEngagementController,
  MyEngagementController,
  SellerEngagementController,
} from './engagement.controller';
import { adjustReviewStats, ReviewsService } from './reviews.service';

// 8x8 JPEG (Pillow) + EXIF APP1(기기·GPS) + COM. jpeg-metadata.spec.ts와 같은 표본.
const GPS_EXIF_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QC0RXhpZgAATU0AKgAAAAgAAwEPAAIAAAAKAAAAMgEQAAIAAAAKAAAAPIglAAQAAAABAAAARgAAAABUZXN0TWFrZXIAVGVzdFBob25lAAAEAAEAAgAAAAJOAAAAAAIABQAAAAMAAAB8AAMAAgAAAAJFAAAAAAQABQAAAAMAAACUAAAAAAAAACUAAAABAAAAIQAAAAEAAAA7AAAAAQAAAH4AAAABAAAAOgAAAAEAAAApAAAAAf/+ABBzZWNyZXQtY29tbWVudP/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AM+iiivOPgT/2Q==',
  'base64',
);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = () => ({ buffer: GPS_EXIF_JPEG, mimetype: 'image/jpeg' });

function order(id: string, status: string, userId = 'user-1') {
  return {
    id,
    userId,
    storeId: 'store-1',
    status,
    orderItems: [{ productId: 'product-1', quantity: 1 }],
  };
}

const BASE = {
  'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
  'stores/store-2': { id: 'store-2', ownerId: 'seller-2' },
  'users/user-1': { id: 'user-1', name: '김그린' },
  'users/user-2': { id: 'user-2', name: '이초록' },
  'orders/order-delivered': order('order-delivered', 'DELIVERED'),
  'orders/order-picked': order('order-picked', 'PICKED_UP'),
  'orders/order-reviewed': order('order-reviewed', 'REVIEWED'),
  'orders/order-other': order('order-other', 'DELIVERED', 'user-2'),
};

function makeStorage() {
  const saved = new Map<string, Buffer>();
  const storage = {
    saved,
    saveReviewPhoto: jest.fn(async (path: string, content: Buffer) => {
      saved.set(path, content);
    }),
    createReviewPhotoReadUrl: jest.fn(
      async (path: string) => `https://signed.example.invalid/${path}`,
    ),
    deleteReviewPhoto: jest.fn(async (path: string) => {
      saved.delete(path);
    }),
  };
  return storage;
}

function setup(initial: Record<string, Record<string, unknown>> = BASE) {
  const { firestore, records } = createMemoryFirestore(initial);
  const storage = makeStorage();
  const service = new ReviewsService(firestore as never, storage as never);
  return { firestore, records, storage, service };
}

const SELLER = { userId: 'seller-1', role: 'seller' };
const OTHER_SELLER = { userId: 'seller-2', role: 'seller' };
const ADMIN = { userId: 'admin-1', role: 'admin' };

async function seedTwoReviews(service: ReviewsService) {
  await service.createReview('order-delivered', 'user-1', {
    productId: 'product-1',
    rating: 5,
    text: '아주 싱싱해요',
  });
  await service.createReview('order-other', 'user-2', {
    productId: 'product-1',
    rating: 1,
    text: '꽃이 다 졌어요',
  });
}

describe('후기 쓰기 권한(로그인한 본인의 배송 완료 주문만)', () => {
  it('고객 경로는 컨트롤러 전체에 로그인 가드, 쓰기·사진·삭제에 고객·관리자 역할 가드를 건다', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MyEngagementController)).toEqual([JwtAuthGuard]);
    for (const handler of [
      MyEngagementController.prototype.createReview,
      MyEngagementController.prototype.addReviewPhotos,
      MyEngagementController.prototype.deleteReview,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['consumer', 'admin']);
    }
  });

  it('숨기기는 판매자·관리자 경로에, 숨김 해제·숨긴 후기 목록은 관리자 경로에만 있다', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SellerEngagementController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, SellerEngagementController)).toEqual(['seller', 'admin']);
    expect(typeof SellerEngagementController.prototype.hideReview).toBe('function');
    expect(
      (SellerEngagementController.prototype as Record<string, unknown>)['unhideReview'],
    ).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminEngagementController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminEngagementController)).toEqual(['admin']);
    expect(typeof AdminEngagementController.prototype.unhideReview).toBe('function');
    expect(typeof AdminEngagementController.prototype.hiddenReviews).toBe('function');
    expect(
      (MyEngagementController.prototype as Record<string, unknown>)['hideReview'],
    ).toBeUndefined();
  });

  it.each([
    'order-delivered',
    'order-picked',
    'order-reviewed',
  ])('배송을 마친 주문(%s)에는 쓸 수 있다', async (orderId) => {
    const { service } = setup();
    await expect(
      service.createReview(orderId, 'user-1', {
        productId: 'product-1',
        rating: 5,
        text: '좋아요 좋아요',
      }),
    ).resolves.toMatchObject({ rating: 5, photoUrls: [] });
  });

  it.each([
    'PENDING',
    'PAID',
    'ACCEPTED',
    'DELIVERING',
    'CANCELLED',
    'REFUNDED',
  ])('배송을 마치지 않은 주문(%s)은 거부한다', async (status) => {
    const { service } = setup({ ...BASE, 'orders/order-x': order('order-x', status) });
    await expect(
      service.createReview('order-x', 'user-1', {
        productId: 'product-1',
        rating: 5,
        text: '좋아요 좋아요',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('없는 주문은 404, 남의 주문은 403이다', async () => {
    const { service, records } = setup();
    const dto = { productId: 'product-1', rating: 5, text: '좋아요 좋아요' };
    await expect(service.createReview('order-missing', 'user-1', dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.createReview('order-other', 'user-1', dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(records.has('reviews/order-other_product-1')).toBe(false);
  });
});

describe('후기 사진(최대 3장, JPEG, 5MB, 메타데이터 제거)', () => {
  it('쓴 사람만 비공개 경로에 올리고, 위치·기기 정보를 지운 바이트를 저장한다', async () => {
    const { service, storage, records } = setup();
    await service.createReview('order-delivered', 'user-1', {
      productId: 'product-1',
      rating: 4,
      text: '꽃이 커요 좋아요',
    });
    const result = await service.addReviewPhotos('order-delivered_product-1', 'user-1', [
      jpeg(),
      jpeg(),
    ]);

    const paths = records.get('reviews/order-delivered_product-1')?.['photoPaths'] as string[];
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path).toMatch(/^reviewPhotos\/order-delivered_product-1\/[0-9a-f-]{36}\.jpg$/);
      const content = storage.saved.get(path)!;
      expect(content.includes(Buffer.from('TestPhone', 'latin1'))).toBe(false);
      expect(content.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    }
    expect(result).toMatchObject({
      hidden: false,
      photoUrls: paths.map((p) => `https://signed.example.invalid/${p}`),
    });
  });

  it('후기 하나에 모두 3장까지만 받는다', async () => {
    const { service, storage } = setup();
    await service.createReview('order-delivered', 'user-1', {
      productId: 'product-1',
      rating: 4,
      text: '꽃이 커요 좋아요',
    });
    await expect(
      service.addReviewPhotos('order-delivered_product-1', 'user-1', [
        jpeg(),
        jpeg(),
        jpeg(),
        jpeg(),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.addReviewPhotos('order-delivered_product-1', 'user-1', [jpeg(), jpeg()]);
    await expect(
      service.addReviewPhotos('order-delivered_product-1', 'user-1', [jpeg(), jpeg()]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.saved.size).toBe(2);
  });

  it('JPEG가 아닌 형식·가짜 JPEG·5MB 초과·빈 파일은 저장하지 않는다', async () => {
    const { service, storage } = setup();
    await service.createReview('order-delivered', 'user-1', {
      productId: 'product-1',
      rating: 4,
      text: '꽃이 커요 좋아요',
    });
    const id = 'order-delivered_product-1';
    for (const file of [
      { buffer: PNG, mimetype: 'image/png' },
      { buffer: GPS_EXIF_JPEG, mimetype: 'image/webp' },
      { buffer: PNG, mimetype: 'image/jpeg' },
      { buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0xff), mimetype: 'image/jpeg' },
      { buffer: Buffer.alloc(0), mimetype: 'image/jpeg' },
    ]) {
      await expect(service.addReviewPhotos(id, 'user-1', [file])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(storage.saveReviewPhoto).not.toHaveBeenCalled();
  });

  it('남의 후기·없는 후기·잘못된 식별자에는 올릴 수 없다', async () => {
    const { service, storage } = setup();
    await service.createReview('order-delivered', 'user-1', {
      productId: 'product-1',
      rating: 4,
      text: '꽃이 커요 좋아요',
    });
    await expect(
      service.addReviewPhotos('order-delivered_product-1', 'user-2', [jpeg()]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.addReviewPhotos('order-delivered_product-9', 'user-1', [jpeg()]),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addReviewPhotos('../users', 'user-1', [jpeg()])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.saveReviewPhoto).not.toHaveBeenCalled();
  });

  it('저장 뒤 후기 갱신이 실패하면 올린 사진을 지운다', async () => {
    const { service, storage, firestore } = setup();
    await service.createReview('order-delivered', 'user-1', {
      productId: 'product-1',
      rating: 4,
      text: '꽃이 커요 좋아요',
    });
    jest.spyOn(firestore, 'runTransaction').mockRejectedValueOnce(new Error('경합'));
    await expect(
      service.addReviewPhotos('order-delivered_product-1', 'user-1', [jpeg()]),
    ).rejects.toThrow('경합');
    expect(storage.deleteReviewPhoto).toHaveBeenCalledTimes(1);
    expect(storage.saved.size).toBe(0);
  });

  it('서명 URL을 만들지 못해도 공개 목록은 사진 없이 돌려준다', async () => {
    const { service, storage } = setup();
    await service.createReview('order-delivered', 'user-1', {
      productId: 'product-1',
      rating: 4,
      text: '꽃이 커요 좋아요',
    });
    await service.addReviewPhotos('order-delivered_product-1', 'user-1', [jpeg()]);
    storage.createReviewPhotoReadUrl.mockRejectedValueOnce(new Error('서명 불가'));
    const { items } = await service.getProductReviews('product-1');
    expect(items[0]?.photoUrls).toEqual([]);
  });
});

describe('고객 본인 후기 삭제', () => {
  it('본인 후기를 지우면 별점 통계와 사진도 함께 정리된다', async () => {
    const { service, storage, records } = setup();
    await seedTwoReviews(service);
    await service.addReviewPhotos('order-delivered_product-1', 'user-1', [jpeg()]);

    await expect(
      service.deleteOwnReview('order-delivered_product-1', 'user-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteOwnReview('order-delivered_product-1', 'user-1')).resolves.toEqual({
      id: 'order-delivered_product-1',
      deleted: true,
    });
    expect(records.has('reviews/order-delivered_product-1')).toBe(false);
    expect(records.get('reviewStats/product-1')).toMatchObject({ count: 1, sum: 1 });
    expect(storage.saved.size).toBe(0);
    await expect(
      service.deleteOwnReview('order-delivered_product-1', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // 지운 뒤에는 같은 주문 상품에 다시 쓸 수 있다.
    await expect(
      service.createReview('order-delivered', 'user-1', {
        productId: 'product-1',
        rating: 3,
        text: '다시 써요 다시',
      }),
    ).resolves.toMatchObject({ rating: 3 });
  });

  it('숨긴 후기를 지우면 이미 빠진 통계를 한 번 더 빼지 않는다', async () => {
    const { service, records } = setup();
    await seedTwoReviews(service);
    await service.hideReview('order-other_product-1', SELLER, 'abuse');
    expect(records.get('reviewStats/product-1')).toMatchObject({ count: 1, sum: 5 });
    await service.deleteOwnReview('order-other_product-1', 'user-2');
    expect(records.get('reviewStats/product-1')).toMatchObject({ count: 1, sum: 5 });
  });
});

describe('판매자·관리자 숨기기와 관리자 숨김 해제', () => {
  it('자기 가게 판매자가 숨기면 공개 목록·별점·가게 통계에서 빠지고, 사유 분류·설명·누가·언제가 남는다', async () => {
    const { service, records } = setup();
    await seedTwoReviews(service);
    expect((await service.getProductReviews('product-1')).summary).toEqual({
      count: 2,
      average: 3,
    });

    const hidden = await service.hideReview(
      'order-other_product-1',
      SELLER,
      'spam',
      '  다른 가게\n홍보 링크  ',
    );
    expect(hidden).toMatchObject({
      hidden: true,
      hiddenReasonCode: 'spam',
      hiddenNote: '다른 가게 홍보 링크',
      hiddenByRole: 'seller',
    });
    expect(hidden.hiddenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const doc = records.get('reviews/order-other_product-1')!;
    expect(doc).toMatchObject({
      hidden: true,
      hiddenReasonCode: 'spam',
      hiddenBy: 'seller-1',
      hiddenByRole: 'seller',
    });
    expect(doc['moderationLog']).toEqual([
      expect.objectContaining({
        action: 'hide',
        by: 'seller-1',
        role: 'seller',
        reasonCode: 'spam',
        note: '다른 가게 홍보 링크',
      }),
    ]);

    const publicList = await service.getProductReviews('product-1');
    expect(publicList.summary).toEqual({ count: 1, average: 5 });
    expect(publicList.items.map((item) => item.id)).toEqual(['order-delivered_product-1']);
    expect(publicList.items[0]).not.toHaveProperty('hidden');
    expect(await service.getStoreReviewStats('store-1')).toEqual({
      'product-1': { count: 1, average: 5 },
    });

    // 판매자 목록에는 숨긴 후기도 상태와 함께 남는다.
    const managed = await service.listStoreReviews('store-1', 'seller-1', 'seller');
    expect(managed.find((review) => review.id === 'order-other_product-1')).toMatchObject({
      hidden: true,
      hiddenReasonCode: 'spam',
      hiddenNote: '다른 가게 홍보 링크',
    });
    // 쓴 사람은 숨김 사실과 사유 분류를 보고, 판매자가 쓴 설명은 받지 않는다.
    const own = await service.listOrderReviews('order-other', 'user-2');
    expect(own[0]).toMatchObject({ hidden: true, hiddenReasonCode: 'spam' });
    expect(own[0]).not.toHaveProperty('hiddenNote');
    expect(own[0]).not.toHaveProperty('hiddenByRole');
  });

  it('설명 없이 사유 분류만으로도 숨길 수 있다', async () => {
    const { service, records } = setup();
    await seedTwoReviews(service);
    const hidden = await service.hideReview('order-other_product-1', SELLER, 'privacy');
    expect(hidden).toMatchObject({ hidden: true, hiddenReasonCode: 'privacy' });
    expect(hidden).not.toHaveProperty('hiddenNote');
    expect(records.get('reviews/order-other_product-1')).not.toHaveProperty('hiddenNote');
  });

  it.each([
    '',
    'low-rating',
    '불만',
    'SPAM',
  ])('목록에 없는 사유(%s)로는 숨길 수 없다', async (reasonCode) => {
    const { service, records } = setup();
    await seedTwoReviews(service);
    await expect(
      service.hideReview('order-other_product-1', SELLER, reasonCode),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(records.get('reviews/order-other_product-1')).toMatchObject({ hidden: false });
  });

  it('판매자는 숨김을 해제할 수 없고, 관리자만 해제한다(통계 복구·이력 유지)', async () => {
    const { service, records } = setup();
    await seedTwoReviews(service);
    await service.hideReview('order-other_product-1', SELLER, 'off-topic', '오해 소지');
    await expect(service.unhideReview('order-other_product-1', SELLER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(records.get('reviews/order-other_product-1')).toMatchObject({ hidden: true });

    const shown = await service.unhideReview('order-other_product-1', ADMIN, '확인 결과 문제 없음');
    expect(shown).toMatchObject({ hidden: false });
    expect(shown).not.toHaveProperty('hiddenReasonCode');
    expect((await service.getProductReviews('product-1')).summary).toEqual({
      count: 2,
      average: 3,
    });

    const doc = records.get('reviews/order-other_product-1')!;
    expect(doc).not.toHaveProperty('hiddenReasonCode');
    expect(doc).not.toHaveProperty('hiddenNote');
    expect(doc['moderationLog']).toEqual([
      expect.objectContaining({
        action: 'hide',
        by: 'seller-1',
        role: 'seller',
        reasonCode: 'off-topic',
        note: '오해 소지',
      }),
      expect.objectContaining({
        action: 'unhide',
        by: 'admin-1',
        role: 'admin',
        note: '확인 결과 문제 없음',
      }),
    ]);
  });

  it('다른 가게 판매자·고객은 숨길 수 없고, 관리자는 어느 가게든 숨길 수 있다', async () => {
    const { service } = setup();
    await seedTwoReviews(service);
    await expect(
      service.hideReview('order-other_product-1', OTHER_SELLER, 'spam'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.hideReview('order-other_product-1', { userId: 'user-1', role: 'consumer' }, 'spam'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.hideReview('order-other_product-1', ADMIN, 'abuse'),
    ).resolves.toMatchObject({
      hidden: true,
      hiddenByRole: 'admin',
    });
  });

  it('두 번 숨기기, 숨기지 않은 후기 해제, 없는 후기는 거부한다', async () => {
    const { service, records } = setup();
    await seedTwoReviews(service);
    await expect(service.unhideReview('order-other_product-1', ADMIN)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await service.hideReview('order-other_product-1', SELLER, 'spam');
    await expect(
      service.hideReview('order-other_product-1', SELLER, 'spam'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.hideReview('order-none_product-1', SELLER, 'spam')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(records.get('reviewStats/product-1')).toMatchObject({ count: 1, sum: 5 });
  });

  it('숨긴 후기에는 사진을 더할 수 없다', async () => {
    const { service } = setup();
    await seedTwoReviews(service);
    await service.hideReview('order-other_product-1', SELLER, 'spam');
    await expect(
      service.addReviewPhotos('order-other_product-1', 'user-2', [jpeg()]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('관리자 숨긴 후기 목록은 숨긴 후기만, 가게·상품 이름과 함께 최신 숨김순으로 준다', async () => {
    const { service } = setup({
      ...BASE,
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1', name: '초록농원' },
      'products/product-1': { id: 'product-1', storeId: 'store-1', name: '호접란 빅립' },
      'orders/order-picked': order('order-picked', 'PICKED_UP', 'user-2'),
    });
    await seedTwoReviews(service);
    await service.createReview('order-picked', 'user-2', {
      productId: 'product-1',
      rating: 2,
      text: '연락처를 남겨요 010',
    });
    await service.hideReview('order-other_product-1', SELLER, 'abuse', '욕설');
    await service.hideReview('order-picked_product-1', ADMIN, 'privacy');

    const list = await service.listHiddenReviews();
    expect(list.map((review) => review.id)).toEqual([
      'order-picked_product-1',
      'order-other_product-1',
    ]);
    expect(list[1]).toMatchObject({
      storeId: 'store-1',
      storeName: '초록농원',
      productName: '호접란 빅립',
      hiddenReasonCode: 'abuse',
      hiddenNote: '욕설',
      hiddenByRole: 'seller',
      rating: 1,
      text: '꽃이 다 졌어요',
    });
    expect(list[0]).toMatchObject({ hiddenReasonCode: 'privacy', hiddenByRole: 'admin' });
  });

  it('통계 조정은 0 아래로 내려가지 않는다', () => {
    expect(adjustReviewStats({ count: 0, sum: 0 }, 5, -1)).toEqual({ count: 0, sum: 0 });
    expect(adjustReviewStats(undefined, 4, 1)).toEqual({ count: 1, sum: 4 });
  });
});
