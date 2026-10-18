import type { ProductReviewsResponse, ReviewPublic, ReviewSummary } from '@greenhub/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { assertStoreOwnerOrAdmin, maskDisplayName } from '../common/store-ownership';
import { FirestoreService } from '../firestore/firestore.service';
import { toSingleLineText } from '../notifications/notification-templates';
import type { CreateReviewDto } from './dto/engagement.dto';

// 팔도감 벤치마킹 비교용 후기·별점.
// - reviews/{orderId}_{productId}: 주문 상품마다 후기 한 건
// - reviewStats/{productId}: 개수·합계(공개 별점 계산용)
// 주문 상태를 바꾸지 않는다(기존 REVIEWED 전이·정산과 분리).

/** 후기를 쓸 수 있는 주문 상태: 배송을 마친 주문. */
export const REVIEWABLE_ORDER_STATUSES = ['DELIVERED', 'PICKED_UP', 'REVIEWED'] as const;
const PUBLIC_REVIEW_LIMIT = 50;

function toIso(value: unknown): string {
  if (typeof value === 'string') return value;
  const v = value as { toDate?: () => Date } | null;
  return v && typeof v.toDate === 'function' ? v.toDate().toISOString() : '';
}

export function reviewSummaryOf(stats: Record<string, unknown> | undefined): ReviewSummary {
  const count = typeof stats?.['count'] === 'number' ? stats['count'] : 0;
  const sum = typeof stats?.['sum'] === 'number' ? stats['sum'] : 0;
  return { count, average: count > 0 ? Math.round((sum / count) * 10) / 10 : 0 };
}

/** 후기 본문은 줄바꿈만 남기고 앞뒤 공백을 지운다. */
export function normalizeReviewText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => toSingleLineText(line, 500))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

@Injectable()
export class ReviewsService {
  constructor(private readonly firestore: FirestoreService) {}

  async createReview(orderId: string, userId: string, dto: CreateReviewDto): Promise<ReviewPublic> {
    const text = normalizeReviewText(dto.text);
    if (text.length < 5) throw new BadRequestException('후기는 다섯 글자 이상 적어 주세요.');
    const reviewId = `${orderId}_${dto.productId}`;
    const reviewRef = this.firestore.doc(`reviews/${reviewId}`);
    const statsRef = this.firestore.doc(`reviewStats/${dto.productId}`);
    let created: ReviewPublic | null = null;

    await this.firestore.runTransaction(async (tx: any) => {
      const [orderSnap, reviewSnap, statsSnap, userSnap] = await Promise.all([
        tx.get(this.firestore.doc(`orders/${orderId}`)),
        tx.get(reviewRef),
        tx.get(statsRef),
        tx.get(this.firestore.doc(`users/${userId}`)),
      ]);
      if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');
      const order = orderSnap.data() as Record<string, any>;
      if (order['userId'] !== userId) throw new ForbiddenException();
      if (!(REVIEWABLE_ORDER_STATUSES as readonly string[]).includes(order['status'])) {
        throw new BadRequestException('배송을 받은 주문에만 후기를 남길 수 있습니다.');
      }
      const items = Array.isArray(order['orderItems']) ? order['orderItems'] : [];
      const inOrder =
        items.some((item: Record<string, unknown>) => item['productId'] === dto.productId) ||
        order['productId'] === dto.productId;
      if (!inOrder) throw new BadRequestException('이 주문에 없는 상품입니다.');
      if (reviewSnap.exists) throw new ConflictException('이미 후기를 남긴 상품입니다.');

      const now = this.firestore.Timestamp.now();
      const authorName = maskDisplayName(userSnap.exists ? userSnap.data()?.['name'] : order['buyerName']);
      const review = {
        id: reviewId,
        storeId: order['storeId'],
        productId: dto.productId,
        orderId,
        userId,
        rating: dto.rating,
        text,
        authorName,
        createdAt: now,
      };
      const stats = statsSnap.exists ? (statsSnap.data() as Record<string, number>) : {};
      tx.set(reviewRef, review);
      tx.set(statsRef, {
        productId: dto.productId,
        storeId: order['storeId'],
        count: (stats['count'] ?? 0) + 1,
        sum: (stats['sum'] ?? 0) + dto.rating,
        updatedAt: now,
      });
      created = this.toPublic(review);
    });
    return created!;
  }

  async getProductReviews(productId: string): Promise<ProductReviewsResponse> {
    const [statsSnap, reviewsSnap] = await Promise.all([
      this.firestore.doc(`reviewStats/${productId}`).get(),
      // 상품 단일 조건만 써서 새 복합 색인 없이 읽고, 최신순 정렬은 메모리에서 한다.
      this.firestore.collection('reviews').where('productId', '==', productId).get(),
    ]);
    const items = reviewsSnap.docs
      .map((doc: any) => this.toPublic(doc.data()))
      .sort((a: ReviewPublic, b: ReviewPublic) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, PUBLIC_REVIEW_LIMIT);
    return { summary: reviewSummaryOf(statsSnap.exists ? statsSnap.data() : undefined), items };
  }

  async getStoreReviewStats(storeId: string): Promise<Record<string, ReviewSummary>> {
    const snap = await this.firestore.collection('reviewStats').where('storeId', '==', storeId).get();
    const result: Record<string, ReviewSummary> = {};
    for (const doc of snap.docs) result[doc.id] = reviewSummaryOf(doc.data());
    return result;
  }

  /** 이 주문에서 이미 후기를 쓴 상품 id. */
  async listOrderReviews(orderId: string, userId: string): Promise<ReviewPublic[]> {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');
    if (orderSnap.data()?.['userId'] !== userId) throw new ForbiddenException();
    const snap = await this.firestore.collection('reviews').where('orderId', '==', orderId).get();
    return snap.docs.map((doc: any) => this.toPublic(doc.data()));
  }

  async listStoreReviews(storeId: string, userId: string, role?: string): Promise<ReviewPublic[]> {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const snap = await this.firestore.collection('reviews').where('storeId', '==', storeId).get();
    return snap.docs
      .map((doc: any) => this.toPublic(doc.data()))
      .sort((a: ReviewPublic, b: ReviewPublic) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
  }

  private toPublic(data: Record<string, any>): ReviewPublic {
    return {
      id: data['id'],
      productId: data['productId'],
      rating: data['rating'],
      text: data['text'],
      authorName: data['authorName'] ?? '구매자',
      createdAt: toIso(data['createdAt']),
    };
  }
}
