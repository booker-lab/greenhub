import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createMemoryFirestore } from '../common/testing/memory-firestore';
import { maskDisplayName } from '../common/store-ownership';
import { EngagementService } from './engagement.service';
import { normalizeReviewText, ReviewsService } from './reviews.service';

/** 사진이 없는 후기 테스트용 Storage. 서명 URL 요청이 오면 실패로 드러난다. */
const NO_STORAGE = {
  saveReviewPhoto: jest.fn(),
  createReviewPhotoReadUrl: jest.fn(),
  deleteReviewPhoto: jest.fn(),
};

const BASE = {
  'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
  'users/user-1': { id: 'user-1', name: '김그린' },
  'products/product-1': { id: 'product-1', storeId: 'store-1', name: '빅립', isActive: true },
  'products/product-hidden': { id: 'product-hidden', storeId: 'store-1', name: '숨김', isActive: false },
  'orders/order-delivered': {
    id: 'order-delivered',
    userId: 'user-1',
    storeId: 'store-1',
    status: 'DELIVERED',
    orderItems: [{ productId: 'product-1', quantity: 1 }],
  },
  'orders/order-paid': {
    id: 'order-paid',
    userId: 'user-1',
    storeId: 'store-1',
    status: 'ACCEPTED',
    orderItems: [{ productId: 'product-1', quantity: 1 }],
  },
};

describe('후기(벤치마킹 비교 기능)', () => {
  it('배송 받은 주문의 상품에 한 번만 후기를 남기고 별점 통계를 올린다', async () => {
    const { firestore, records } = createMemoryFirestore(BASE);
    const service = new ReviewsService(firestore as never, NO_STORAGE as never);
    const review = await service.createReview('order-delivered', 'user-1', {
      productId: 'product-1',
      rating: 4,
      text: '  꽃이 크고 싱싱해요  ',
    });
    expect(review).toMatchObject({ rating: 4, text: '꽃이 크고 싱싱해요', authorName: '김*린' });
    expect(records.get('reviewStats/product-1')).toMatchObject({ count: 1, sum: 4, storeId: 'store-1' });

    await expect(
      service.createReview('order-delivered', 'user-1', { productId: 'product-1', rating: 5, text: '두 번째 후기' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const reviews = await service.getProductReviews('product-1');
    expect(reviews.summary).toEqual({ count: 1, average: 4 });
    expect(reviews.items[0]).not.toHaveProperty('userId');
    expect(reviews.items[0]).not.toHaveProperty('orderId');
    expect(await service.getStoreReviewStats('store-1')).toEqual({ 'product-1': { count: 1, average: 4 } });
  });

  it('배송 전 주문, 남의 주문, 주문에 없는 상품은 거부한다', async () => {
    const { firestore } = createMemoryFirestore(BASE);
    const service = new ReviewsService(firestore as never, NO_STORAGE as never);
    const dto = { productId: 'product-1', rating: 5, text: '좋아요 좋아요' };
    await expect(service.createReview('order-paid', 'user-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createReview('order-delivered', 'user-2', dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.createReview('order-delivered', 'user-1', { ...dto, productId: 'product-2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('후기 본문 정리와 이름 가리기', () => {
    expect(normalizeReviewText('첫 줄\r\n\r\n\r\n\r\n둘째   줄 ')).toBe('첫 줄\n\n둘째 줄');
    expect(maskDisplayName('김그린')).toBe('김*린');
    expect(maskDisplayName('남궁민수')).toBe('남**수');
    expect(maskDisplayName('')).toBe('구매자');
  });
});

/** 실제 AuditService.logAdmin과 같은 경로(adminAuditLogs)에 같은 트랜잭션으로 쓰는 테스트용 기록기. */
function auditOf(firestore: { doc: (path: string) => unknown }) {
  let seq = 0;
  return {
    logAdmin: jest.fn(async (entry: Record<string, unknown>, tx?: { set: (ref: unknown, data: unknown) => void }) => {
      seq += 1;
      const ref = firestore.doc(`adminAuditLogs/log-${seq}`);
      const record = { before: null, after: null, ...entry };
      if (tx) tx.set(ref, record);
      else await (ref as { set: (data: unknown) => Promise<void> }).set(record);
    }),
  };
}

describe('다음 회차 알림·찾는 상품·입점 문의(벤치마킹 비교 기능)', () => {
  it('공개 상품만 알림 신청하며, 판매자는 신청 수를 모아 본다', async () => {
    const { firestore } = createMemoryFirestore(BASE);
    const service = new EngagementService(firestore as never, auditOf(firestore) as never);
    await expect(service.subscribeRestock('user-1', 'product-hidden')).rejects.toBeInstanceOf(NotFoundException);

    await service.subscribeRestock('user-1', 'product-1');
    await service.subscribeRestock('user-2', 'product-1');
    expect(await service.listMyRestock('user-1')).toEqual(['product-1']);
    expect(await service.restockSummary('store-1', 'seller-1', 'seller')).toEqual([
      { productId: 'product-1', productName: '빅립', count: 2 },
    ]);
    await expect(service.restockSummary('store-1', 'someone', 'seller')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('찾는 상품은 이름 한 줄만, 입점 문의는 파기 예정 시각과 함께 저장한다', async () => {
    const { firestore, records } = createMemoryFirestore(BASE);
    const service = new EngagementService(firestore as never, auditOf(firestore) as never);
    await service.createProductRequest('store-1', ' 덴드로비움\n 흰색 ');
    const requests = await service.listProductRequests('store-1', 'seller-1', 'seller');
    expect(requests.map((r) => r.text)).toEqual(['덴드로비움 흰색']);
    await expect(service.createProductRequest('missing', '튤립')).rejects.toBeInstanceOf(NotFoundException);

    const { id } = await service.createPartnerInquiry({
      farmName: '초록농원',
      region: '경기 용인',
      contact: '010-1234-5678',
      message: '호접란을 함께 팔고 싶어요.',
      privacyConsent: true,
    });
    expect(records.get(`partnerInquiries/${id}`)?.['deleteAfter']).toBeInstanceOf(Date);
    expect((await service.listPartnerInquiries())[0]).toMatchObject({ farmName: '초록농원' });
  });

  it('파기 예정 시각이 지난 입점 문의만 지우고, 시각이 없는 문서는 남긴다', async () => {
    const { firestore, records } = createMemoryFirestore({
      'partnerInquiries/old': { id: 'old', deleteAfter: new Date('2026-01-01T00:00:00Z') },
      'partnerInquiries/fresh': { id: 'fresh', deleteAfter: new Date('2027-12-31T00:00:00Z') },
      'partnerInquiries/unknown': { id: 'unknown' },
    });
    const service = new EngagementService(firestore as never, auditOf(firestore) as never);
    expect(await service.purgeExpiredPartnerInquiries(new Date('2026-10-17T00:00:00Z'))).toEqual({
      deleted: 1,
      skipped: 1,
    });
    expect(records.has('partnerInquiries/old')).toBe(false);
    expect(records.has('partnerInquiries/fresh')).toBe(true);
    expect(records.has('partnerInquiries/unknown')).toBe(true);
  });

  it('관리자 연락함 표시는 상태만 바꾸고, 행동 기록에 연락처·내용을 넣지 않는다', async () => {
    const { firestore, records } = createMemoryFirestore({
      'partnerInquiries/inq-1': {
        id: 'inq-1',
        farmName: '초록농원',
        region: '경기 용인',
        contact: '010-1234-5678',
        message: '호접란을 함께 팔고 싶어요.',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    });
    const service = new EngagementService(firestore as never, auditOf(firestore) as never);
    expect((await service.listPartnerInquiries())[0].contactedAt).toBeNull();

    const marked = await service.setPartnerInquiryContacted('inq-1', true, 'admin-1');
    expect(marked.contactedAt).toEqual(expect.any(String));
    expect((await service.listPartnerInquiries())[0].contactedAt).toBe(marked.contactedAt);
    expect(records.get('partnerInquiries/inq-1')).toMatchObject({ contactedBy: 'admin-1', contact: '010-1234-5678' });

    await service.setPartnerInquiryContacted('inq-1', false, 'admin-1');
    expect((await service.listPartnerInquiries())[0].contactedAt).toBeNull();

    const logs = Array.from(records.entries()).filter(([path]) => path.startsWith('adminAuditLogs/'));
    expect(logs.map(([, log]) => [log['action'], log['before'], log['after']])).toEqual([
      ['admin.partner_inquiry.contacted', { contacted: false }, { contacted: true }],
      ['admin.partner_inquiry.contacted', { contacted: true }, { contacted: false }],
    ]);
    expect(JSON.stringify(logs)).not.toContain('010-1234-5678');
    expect(JSON.stringify(logs)).not.toContain('호접란');

    await expect(service.setPartnerInquiryContacted('missing', true, 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('관리자 삭제는 문서를 지우고 ID만 기록하며, 없는 문의·경로 ID는 404이고 기록을 남기지 않는다', async () => {
    const { firestore, records } = createMemoryFirestore({
      'partnerInquiries/inq-1': { id: 'inq-1', contact: 'farm@example.test', message: '연락 주세요' },
    });
    const audit = auditOf(firestore);
    const service = new EngagementService(firestore as never, audit as never);

    expect(await service.deletePartnerInquiry('inq-1', 'admin-1')).toEqual({ id: 'inq-1' });
    expect(records.has('partnerInquiries/inq-1')).toBe(false);
    const logs = Array.from(records.entries()).filter(([path]) => path.startsWith('adminAuditLogs/'));
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({
      action: 'admin.partner_inquiry.deleted',
      actorId: 'admin-1',
      targetType: 'partner_inquiry',
      targetId: 'inq-1',
      before: null,
      after: null,
    });
    expect(JSON.stringify(logs)).not.toContain('farm@example.test');

    await expect(service.deletePartnerInquiry('inq-1', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deletePartnerInquiry('a/b', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.logAdmin).toHaveBeenCalledTimes(1);
  });
});
