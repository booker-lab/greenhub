import { randomUUID } from 'node:crypto';
import {
  type AdminHiddenReview,
  type ManagedReview,
  type OwnReview,
  type ProductReviewsResponse,
  REVIEW_HIDE_REASON_MAX_LENGTH,
  REVIEW_HIDE_REASONS,
  REVIEW_PHOTO_CONTENT_TYPES,
  REVIEW_PHOTO_MAX_BYTES,
  REVIEW_PHOTO_MAX_COUNT,
  type ReviewHideReason,
  type ReviewModeratorRole,
  type ReviewPublic,
  type ReviewSummary,
} from '@greenhub/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { assertStoreOwnerOrAdmin, maskDisplayName } from '../common/store-ownership';
import { FirestoreService } from '../firestore/firestore.service';
import { stripJpegMetadata } from '../firestore/jpeg-metadata';
import { StorageService } from '../firestore/storage.service';
import { toSingleLineText } from '../notifications/notification-templates';
import type { CreateReviewDto } from './dto/engagement.dto';

// 팔도감 벤치마킹 비교용 후기·별점.
// - reviews/{orderId}_{productId}: 주문 상품마다 후기 한 건
// - reviewStats/{productId}: 숨기지 않은 후기의 개수·합계(공개 별점 계산용)
// - reviewPhotos/{reviewId}/{photoId}.jpg: 후기 사진(서버만 쓰고 서명 URL로만 읽는다)
// 주문 상태를 바꾸지 않는다(기존 REVIEWED 전이·정산과 분리).

/** 후기를 쓸 수 있는 주문 상태: 배송을 마친 주문. */
export const REVIEWABLE_ORDER_STATUSES = ['DELIVERED', 'PICKED_UP', 'REVIEWED'] as const;
const PUBLIC_REVIEW_LIMIT = 50;
const MODERATION_LOG_LIMIT = 20;
const ADMIN_HIDDEN_REVIEW_LIMIT = 200;
// {orderId}_{productId}: 각 식별자는 DOCUMENT_ID_PATTERN(128자)을 따른다.
const REVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{1,257}$/;

export interface ReviewPhotoUpload {
  buffer: Buffer;
  mimetype: string;
  size?: number;
}

export interface ReviewModerator {
  userId: string;
  role?: string;
}

type ReviewRecord = Record<string, any>;

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

/** 숨긴 후기는 공개 목록·별점에서 빠진다. 예전 문서(필드 없음)는 숨기지 않은 후기다. */
export function isHiddenReview(data: ReviewRecord | undefined): boolean {
  return data?.['hidden'] === true;
}

export function isReviewHideReason(value: unknown): value is ReviewHideReason {
  return typeof value === 'string' && (REVIEW_HIDE_REASONS as readonly string[]).includes(value);
}

function photoPathsOf(data: ReviewRecord | undefined): string[] {
  const paths = data?.['photoPaths'];
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === 'string')
    : [];
}

/** 별점 통계에 후기 하나를 더하거나(+1) 뺀다(-1). 음수로 내려가지 않는다. */
export function adjustReviewStats(
  stats: Record<string, unknown> | undefined,
  rating: number,
  direction: 1 | -1,
): { count: number; sum: number } {
  const count = typeof stats?.['count'] === 'number' ? stats['count'] : 0;
  const sum = typeof stats?.['sum'] === 'number' ? stats['sum'] : 0;
  return {
    count: Math.max(0, count + direction),
    sum: Math.max(0, sum + direction * rating),
  };
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly storage: StorageService,
  ) {}

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
      const authorName = maskDisplayName(
        userSnap.exists ? userSnap.data()?.['name'] : order['buyerName'],
      );
      const review = {
        id: reviewId,
        storeId: order['storeId'],
        productId: dto.productId,
        orderId,
        userId,
        rating: dto.rating,
        text,
        authorName,
        photoPaths: [],
        hidden: false,
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
      created = this.toPublic(review, []);
    });
    return created!;
  }

  /** 쓴 사람이 자기 후기에 사진을 더한다. 후기 하나에 모두 REVIEW_PHOTO_MAX_COUNT장까지. */
  async addReviewPhotos(
    reviewId: string,
    userId: string,
    files: ReviewPhotoUpload[],
  ): Promise<OwnReview> {
    this.assertReviewId(reviewId);
    if (files.length === 0) throw new BadRequestException('사진을 한 장 이상 골라 주세요.');
    if (files.length > REVIEW_PHOTO_MAX_COUNT) {
      throw new BadRequestException(`사진은 ${REVIEW_PHOTO_MAX_COUNT}장까지 올릴 수 있어요.`);
    }
    const contents = files.map((file) => this.cleanPhoto(file));

    const reviewRef = this.firestore.doc(`reviews/${reviewId}`);
    const before = await reviewRef.get();
    this.assertPhotoSlots(before.exists ? before.data() : undefined, userId, contents.length);

    const uploaded: string[] = [];
    try {
      for (const content of contents) {
        const path = `reviewPhotos/${reviewId}/${randomUUID()}.jpg`;
        await this.storage.saveReviewPhoto(path, content);
        uploaded.push(path);
      }
      let saved: ReviewRecord | null = null;
      await this.firestore.runTransaction(async (tx: any) => {
        const snap = await tx.get(reviewRef);
        const data = snap.exists ? (snap.data() as ReviewRecord) : undefined;
        this.assertPhotoSlots(data, userId, uploaded.length);
        const photoPaths = [...photoPathsOf(data), ...uploaded];
        tx.update(reviewRef, { photoPaths });
        saved = { ...data, photoPaths };
      });
      return this.toOwn(saved!);
    } catch (error) {
      await this.deletePhotosQuietly(uploaded, reviewId);
      throw error;
    }
  }

  /** 쓴 사람이 자기 후기를 지운다. 숨기지 않은 후기였다면 별점 통계에서도 뺀다. */
  async deleteOwnReview(reviewId: string, userId: string): Promise<{ id: string; deleted: true }> {
    this.assertReviewId(reviewId);
    const reviewRef = this.firestore.doc(`reviews/${reviewId}`);
    let photoPaths: string[] = [];
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(reviewRef);
      if (!snap.exists) throw new NotFoundException('후기를 찾을 수 없습니다.');
      const data = snap.data() as ReviewRecord;
      if (data['userId'] !== userId)
        throw new ForbiddenException('내가 쓴 후기만 지울 수 있습니다.');
      const statsRef = this.firestore.doc(`reviewStats/${data['productId']}`);
      const statsSnap = await tx.get(statsRef);
      photoPaths = photoPathsOf(data);
      tx.delete(reviewRef);
      if (!isHiddenReview(data) && statsSnap.exists) {
        tx.update(statsRef, {
          ...adjustReviewStats(statsSnap.data(), data['rating'], -1),
          updatedAt: this.firestore.Timestamp.now(),
        });
      }
    });
    await this.deletePhotosQuietly(photoPaths, reviewId);
    return { id: reviewId, deleted: true };
  }

  /**
   * 판매자(자기 가게)·관리자가 후기를 숨긴다. 사유는 정해진 분류에서만 고르고 설명은 선택이다.
   * 공개 목록·별점에서 빠지고 사유·설명·시각·사람·역할을 남긴다.
   */
  async hideReview(
    reviewId: string,
    moderator: ReviewModerator,
    reasonCode: string,
    note?: string,
  ): Promise<ManagedReview> {
    if (!isReviewHideReason(reasonCode)) {
      throw new BadRequestException('숨김 사유를 목록에서 골라 주세요.');
    }
    return this.moderate(reviewId, moderator, {
      action: 'hide',
      reasonCode,
      note: toSingleLineText(note ?? '', REVIEW_HIDE_REASON_MAX_LENGTH),
    });
  }

  /** 숨긴 후기를 다시 공개한다. 관리자만 할 수 있고, 해제 기록도 이력에 남긴다. */
  async unhideReview(
    reviewId: string,
    moderator: ReviewModerator,
    note?: string,
  ): Promise<ManagedReview> {
    if (moderator.role !== 'admin') {
      throw new ForbiddenException('숨김 해제는 관리자만 할 수 있습니다.');
    }
    return this.moderate(reviewId, moderator, {
      action: 'unhide',
      note: toSingleLineText(note ?? '', REVIEW_HIDE_REASON_MAX_LENGTH),
    });
  }

  /** 관리자 콘솔: 숨긴 후기 전체(가게·상품 이름 포함), 숨긴 시각 최신순. */
  async listHiddenReviews(): Promise<AdminHiddenReview[]> {
    // 단일 필드 같음 조건이라 새 복합 색인이 필요 없다.
    const snap = await this.firestore.collection('reviews').where('hidden', '==', true).get();
    const recent = snap.docs
      .map((doc: any) => doc.data() as ReviewRecord)
      .sort((a: ReviewRecord, b: ReviewRecord) =>
        toIso(b['hiddenAt']).localeCompare(toIso(a['hiddenAt'])),
      )
      .slice(0, ADMIN_HIDDEN_REVIEW_LIMIT);
    const [stores, products] = await Promise.all([
      this.namesOf(
        'stores',
        recent.map((data: ReviewRecord) => data['storeId']),
      ),
      this.namesOf(
        'products',
        recent.map((data: ReviewRecord) => data['productId']),
      ),
    ]);
    return Promise.all(
      recent.map(async (data: ReviewRecord) => ({
        ...(await this.toManaged(data)),
        storeId: data['storeId'],
        storeName: stores.get(data['storeId']) ?? null,
        productName: products.get(data['productId']) ?? null,
      })),
    );
  }

  async getProductReviews(productId: string): Promise<ProductReviewsResponse> {
    const [statsSnap, reviewsSnap] = await Promise.all([
      this.firestore.doc(`reviewStats/${productId}`).get(),
      // 상품 단일 조건만 써서 새 복합 색인 없이 읽고, 숨김 제외·최신순 정렬은 메모리에서 한다.
      this.firestore.collection('reviews').where('productId', '==', productId).get(),
    ]);
    const shown = reviewsSnap.docs
      .map((doc: any) => doc.data() as ReviewRecord)
      .filter((data: ReviewRecord) => !isHiddenReview(data))
      .sort((a: ReviewRecord, b: ReviewRecord) =>
        toIso(b['createdAt']).localeCompare(toIso(a['createdAt'])),
      )
      .slice(0, PUBLIC_REVIEW_LIMIT);
    const items = await Promise.all(
      shown.map(async (data: ReviewRecord) => this.toPublic(data, await this.photoUrlsOf(data))),
    );
    return { summary: reviewSummaryOf(statsSnap.exists ? statsSnap.data() : undefined), items };
  }

  async getStoreReviewStats(storeId: string): Promise<Record<string, ReviewSummary>> {
    const snap = await this.firestore
      .collection('reviewStats')
      .where('storeId', '==', storeId)
      .get();
    const result: Record<string, ReviewSummary> = {};
    for (const doc of snap.docs) result[doc.id] = reviewSummaryOf(doc.data());
    return result;
  }

  /** 이 주문에서 이미 쓴 후기(숨김 여부 포함). */
  async listOrderReviews(orderId: string, userId: string): Promise<OwnReview[]> {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');
    if (orderSnap.data()?.['userId'] !== userId) throw new ForbiddenException();
    const snap = await this.firestore.collection('reviews').where('orderId', '==', orderId).get();
    return Promise.all(
      snap.docs
        .map((doc: any) => doc.data() as ReviewRecord)
        // 같은 주문 id를 쓰는 남의 문서가 섞이지 않게 쓴 사람도 확인한다.
        .filter((data: ReviewRecord) => data['userId'] === userId)
        .map((data: ReviewRecord) => this.toOwn(data)),
    );
  }

  async listStoreReviews(storeId: string, userId: string, role?: string): Promise<ManagedReview[]> {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const snap = await this.firestore.collection('reviews').where('storeId', '==', storeId).get();
    const recent = snap.docs
      .map((doc: any) => doc.data() as ReviewRecord)
      .sort((a: ReviewRecord, b: ReviewRecord) =>
        toIso(b['createdAt']).localeCompare(toIso(a['createdAt'])),
      )
      .slice(0, 100);
    return Promise.all(recent.map((data: ReviewRecord) => this.toManaged(data)));
  }

  private async moderate(
    reviewId: string,
    moderator: ReviewModerator,
    change:
      | { action: 'hide'; reasonCode: ReviewHideReason; note: string }
      | { action: 'unhide'; note: string },
  ): Promise<ManagedReview> {
    const { action } = change;
    this.assertReviewId(reviewId);
    const reviewRef = this.firestore.doc(`reviews/${reviewId}`);
    const before = await reviewRef.get();
    if (!before.exists) throw new NotFoundException('후기를 찾을 수 없습니다.');
    // 판매자는 자기 가게 후기만, 관리자는 모든 후기를 다룬다.
    await assertStoreOwnerOrAdmin(
      this.firestore,
      before.data()?.['storeId'],
      moderator.userId,
      moderator.role,
    );
    const byRole: ReviewModeratorRole = moderator.role === 'admin' ? 'admin' : 'seller';

    let saved: ReviewRecord | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(reviewRef);
      if (!snap.exists) throw new NotFoundException('후기를 찾을 수 없습니다.');
      const data = snap.data() as ReviewRecord;
      if (data['storeId'] !== before.data()?.['storeId'])
        throw new ConflictException('후기가 바뀌었습니다. 다시 시도해 주세요.');
      const statsRef = this.firestore.doc(`reviewStats/${data['productId']}`);
      const statsSnap = await tx.get(statsRef);
      const hidden = isHiddenReview(data);
      if (action === 'hide' && hidden) throw new ConflictException('이미 숨긴 후기입니다.');
      if (action === 'unhide' && !hidden) throw new ConflictException('숨기지 않은 후기입니다.');

      const now = this.firestore.Timestamp.now();
      const log = Array.isArray(data['moderationLog']) ? data['moderationLog'] : [];
      const entry = {
        action,
        by: moderator.userId,
        role: byRole,
        at: now,
        ...(change.action === 'hide' ? { reasonCode: change.reasonCode } : {}),
        note: change.note,
      };
      const {
        hiddenReasonCode: _c,
        hiddenNote: _n,
        hiddenAt: _a,
        hiddenBy: _b,
        hiddenByRole: _br,
        ...rest
      } = data;
      const next: ReviewRecord = {
        ...rest,
        hidden: action === 'hide',
        ...(change.action === 'hide'
          ? {
              hiddenReasonCode: change.reasonCode,
              ...(change.note ? { hiddenNote: change.note } : {}),
              hiddenAt: now,
              hiddenBy: moderator.userId,
              hiddenByRole: byRole,
            }
          : {}),
        moderationLog: [...log, entry].slice(-MODERATION_LOG_LIMIT),
      };
      tx.set(reviewRef, next);
      tx.set(
        statsRef,
        {
          productId: data['productId'],
          storeId: data['storeId'],
          ...adjustReviewStats(
            statsSnap.exists ? statsSnap.data() : undefined,
            data['rating'],
            action === 'hide' ? -1 : 1,
          ),
          updatedAt: now,
        },
        { merge: true },
      );
      saved = next;
    });
    return this.toManaged(saved!);
  }

  private assertReviewId(reviewId: string): void {
    if (typeof reviewId !== 'string' || !REVIEW_ID_PATTERN.test(reviewId)) {
      throw new BadRequestException('후기 식별자 형식이 올바르지 않습니다.');
    }
  }

  private assertPhotoSlots(data: ReviewRecord | undefined, userId: string, adding: number): void {
    if (!data) throw new NotFoundException('후기를 찾을 수 없습니다.');
    if (data['userId'] !== userId)
      throw new ForbiddenException('내가 쓴 후기에만 사진을 올릴 수 있습니다.');
    if (isHiddenReview(data))
      throw new BadRequestException('숨겨진 후기에는 사진을 더할 수 없습니다.');
    if (photoPathsOf(data).length + adding > REVIEW_PHOTO_MAX_COUNT) {
      throw new BadRequestException(
        `사진은 후기 하나에 ${REVIEW_PHOTO_MAX_COUNT}장까지 올릴 수 있어요.`,
      );
    }
  }

  /** 형식·크기를 확인하고 위치·기기 정보(EXIF 등)를 지운 JPEG 바이트를 돌려준다. */
  private cleanPhoto(file: ReviewPhotoUpload): Buffer {
    if (!(REVIEW_PHOTO_CONTENT_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException('JPEG 사진만 올릴 수 있어요.');
    }
    const size = file.buffer?.length ?? 0;
    if (size === 0 || size > REVIEW_PHOTO_MAX_BYTES) {
      throw new BadRequestException('사진 한 장은 5MB 이하여야 해요.');
    }
    try {
      return stripJpegMetadata(file.buffer);
    } catch {
      throw new BadRequestException('JPEG 사진만 올릴 수 있어요.');
    }
  }

  private async deletePhotosQuietly(paths: string[], reviewId: string): Promise<void> {
    const results = await Promise.allSettled(
      paths.map((path) => this.storage.deleteReviewPhoto(path)),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      // 비공개 경로라 노출되지는 않는다. 남은 객체는 운영에서 경로로 찾아 지운다.
      this.logger.warn(`후기 사진 ${failed}장을 지우지 못했습니다 (reviewId=${reviewId}).`);
    }
  }

  /** 서명 URL을 만들지 못해도(로컬 실행 등) 후기 목록은 사진 없이 보여준다. */
  private async photoUrlsOf(data: ReviewRecord): Promise<string[]> {
    const paths = photoPathsOf(data);
    if (paths.length === 0) return [];
    try {
      return await Promise.all(paths.map((path) => this.storage.createReviewPhotoReadUrl(path)));
    } catch {
      this.logger.warn(`후기 사진 주소를 만들지 못했습니다 (reviewId=${data['id']}).`);
      return [];
    }
  }

  /** 문서 id → name 지도(없거나 이름이 없으면 null). */
  private async namesOf(collection: string, ids: unknown[]): Promise<Map<string, string | null>> {
    const unique = [
      ...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ];
    const snaps = await Promise.all(
      unique.map((id) => this.firestore.doc(`${collection}/${id}`).get()),
    );
    return new Map(
      snaps.map((doc: any, index: number): [string, string | null] => {
        const name = doc.exists ? doc.data()?.['name'] : null;
        return [unique[index], typeof name === 'string' ? name : null];
      }),
    );
  }

  private async toOwn(data: ReviewRecord): Promise<OwnReview> {
    const review: OwnReview = {
      ...this.toPublic(data, await this.photoUrlsOf(data)),
      hidden: isHiddenReview(data),
    };
    // 쓴 사람에게는 숨김 사실과 사유 분류만 보낸다(숨긴 사람이 쓴 설명은 보내지 않는다).
    if (review.hidden && isReviewHideReason(data['hiddenReasonCode'])) {
      review.hiddenReasonCode = data['hiddenReasonCode'];
    }
    return review;
  }

  private async toManaged(data: ReviewRecord): Promise<ManagedReview> {
    const review: ManagedReview = {
      ...this.toPublic(data, await this.photoUrlsOf(data)),
      hidden: isHiddenReview(data),
    };
    if (review.hidden) {
      if (isReviewHideReason(data['hiddenReasonCode'])) {
        review.hiddenReasonCode = data['hiddenReasonCode'];
      }
      if (typeof data['hiddenNote'] === 'string' && data['hiddenNote']) {
        review.hiddenNote = data['hiddenNote'];
      }
      const hiddenAt = toIso(data['hiddenAt']);
      if (hiddenAt) review.hiddenAt = hiddenAt;
      if (data['hiddenByRole'] === 'admin' || data['hiddenByRole'] === 'seller') {
        review.hiddenByRole = data['hiddenByRole'];
      }
    }
    return review;
  }

  private toPublic(data: ReviewRecord, photoUrls: string[]): ReviewPublic {
    return {
      id: data['id'],
      productId: data['productId'],
      rating: data['rating'],
      text: data['text'],
      authorName: data['authorName'] ?? '구매자',
      createdAt: toIso(data['createdAt']),
      photoUrls,
    };
  }
}
