import type { PartnerInquiryItem, ProductRequestItem, RestockSummaryItem } from '@greenhub/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { assertStoreOwnerOrAdmin } from '../common/store-ownership';
import { FirestoreService } from '../firestore/firestore.service';
import { toSingleLineText } from '../notifications/notification-templates';
import { isPubliclyVisibleProduct } from '../products/product-visibility';
import type { CreatePartnerInquiryDto } from './dto/engagement.dto';

// 팔도감 벤치마킹 비교용 찜·다음 회차 알림 신청·찾는 상품 제안·입점 문의.
// - wishlists/{userId}/items/{productId}
// - restockSubscriptions/{productId}_{userId}: 신청만 모은다. 알림 발송은 하지 않는다(발송은 별도 승인·템플릿 필요).
// - productRequests/{id}: 상품 이름만 받는다(개인정보 없음).
// - partnerInquiries/{id}: 연락처를 받으므로 1년 뒤 파기 예정 시각을 함께 둔다.

export const PARTNER_INQUIRY_RETENTION_DAYS = 365;

function toIso(value: unknown): string {
  if (typeof value === 'string') return value;
  const v = value as { toDate?: () => Date } | null;
  return v && typeof v.toDate === 'function' ? v.toDate().toISOString() : '';
}

@Injectable()
export class EngagementService {
  constructor(private readonly firestore: FirestoreService) {}

  // ── 찜 ──
  async listWishlist(userId: string): Promise<string[]> {
    const snap = await this.firestore.collection(`wishlists/${userId}/items`).get();
    return snap.docs
      .map((doc: any) => ({ id: doc.id as string, at: toIso(doc.data()['createdAt']) }))
      .sort((a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at))
      .map((entry: { id: string }) => entry.id);
  }

  async addWishlist(userId: string, productId: string): Promise<{ productId: string }> {
    const product = await this.getPublicProduct(productId);
    await this.firestore.doc(`wishlists/${userId}/items/${productId}`).set({
      productId,
      storeId: product['storeId'],
      createdAt: this.firestore.Timestamp.now(),
    });
    return { productId };
  }

  async removeWishlist(userId: string, productId: string): Promise<{ productId: string }> {
    await this.firestore.doc(`wishlists/${userId}/items/${productId}`).delete();
    return { productId };
  }

  // ── 다음 회차 알림 신청 ──
  async listMyRestock(userId: string): Promise<string[]> {
    const snap = await this.firestore
      .collection('restockSubscriptions')
      .where('userId', '==', userId)
      .get();
    return snap.docs.map((doc: any) => doc.data()['productId']);
  }

  async subscribeRestock(userId: string, productId: string): Promise<{ productId: string }> {
    const product = await this.getPublicProduct(productId);
    await this.firestore.doc(`restockSubscriptions/${productId}_${userId}`).set({
      productId,
      storeId: product['storeId'],
      userId,
      createdAt: this.firestore.Timestamp.now(),
    });
    return { productId };
  }

  async unsubscribeRestock(userId: string, productId: string): Promise<{ productId: string }> {
    await this.firestore.doc(`restockSubscriptions/${productId}_${userId}`).delete();
    return { productId };
  }

  async restockSummary(storeId: string, userId: string, role?: string): Promise<RestockSummaryItem[]> {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const snap = await this.firestore
      .collection('restockSubscriptions')
      .where('storeId', '==', storeId)
      .get();
    const counts = new Map<string, number>();
    for (const doc of snap.docs) {
      const productId = doc.data()['productId'];
      counts.set(productId, (counts.get(productId) ?? 0) + 1);
    }
    const items: RestockSummaryItem[] = [];
    for (const [productId, count] of counts) {
      const product = await this.firestore.doc(`products/${productId}`).get();
      items.push({
        productId,
        productName: product.exists ? (product.data()?.['name'] ?? null) : null,
        count,
      });
    }
    return items.sort((a, b) => b.count - a.count);
  }

  // ── 찾는 상품 제안 ──
  async createProductRequest(storeId: string, rawText: string): Promise<{ id: string }> {
    const store = await this.firestore.doc(`stores/${storeId}`).get();
    if (!store.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');
    const text = toSingleLineText(rawText, 60);
    const id = randomUUID();
    await this.firestore.doc(`productRequests/${id}`).set({
      id,
      storeId,
      text,
      createdAt: this.firestore.Timestamp.now(),
    });
    return { id };
  }

  async listProductRequests(storeId: string, userId: string, role?: string): Promise<ProductRequestItem[]> {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const snap = await this.firestore.collection('productRequests').where('storeId', '==', storeId).get();
    return snap.docs
      .map((doc: any) => {
        const data = doc.data();
        return { id: doc.id, text: data['text'], createdAt: toIso(data['createdAt']) };
      })
      .sort((a: ProductRequestItem, b: ProductRequestItem) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200);
  }

  // ── 입점 문의 ──
  async createPartnerInquiry(dto: CreatePartnerInquiryDto): Promise<{ id: string }> {
    const id = randomUUID();
    const now = this.firestore.Timestamp.now();
    const nowMillis = (now as { toMillis?: () => number }).toMillis?.() ?? Date.now();
    await this.firestore.doc(`partnerInquiries/${id}`).set({
      id,
      farmName: toSingleLineText(dto.farmName, 40),
      region: toSingleLineText(dto.region, 30),
      contact: toSingleLineText(dto.contact, 80),
      message: dto.message.replace(/\r\n?/g, '\n').trim().slice(0, 500),
      privacyConsentAt: now,
      createdAt: now,
      deleteAfter: new Date(nowMillis + PARTNER_INQUIRY_RETENTION_DAYS * 24 * 3600 * 1000),
    });
    return { id };
  }

  async listPartnerInquiries(): Promise<PartnerInquiryItem[]> {
    const snap = await this.firestore.collection('partnerInquiries').get();
    return snap.docs
      .map((doc: any) => {
        const data = doc.data();
        return {
          id: doc.id,
          farmName: data['farmName'],
          region: data['region'],
          contact: data['contact'],
          message: data['message'],
          createdAt: toIso(data['createdAt']),
        };
      })
      .sort((a: PartnerInquiryItem, b: PartnerInquiryItem) => b.createdAt.localeCompare(a.createdAt));
  }

  private async getPublicProduct(productId: string): Promise<Record<string, unknown>> {
    const snap = await this.firestore.doc(`products/${productId}`).get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    if (!data || !isPubliclyVisibleProduct(data)) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    return data;
  }
}
