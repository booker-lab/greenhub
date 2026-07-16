import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { PaymentsService } from '../payments/payments.service';
import { AligoClient } from './aligo.client';

export type NotificationTemplateCode =
  // 소비자 수신
  | 'ORDER_ACCEPTED'
  | 'ORDER_PREPARING'
  | 'ORDER_DELIVERING'
  | 'ORDER_HUB_ARRIVED'
  | 'ORDER_DELIVERED'
  | 'ORDER_CANCELLED'
  | 'GROUP_JOINED'
  | 'GROUP_DEADLINE_SOON'
  | 'GROUP_CONFIRMED'
  | 'GROUP_CANCELLED_LACK'
  | 'GROUP_CANCELLED_SELF'
  | 'GROUP_PREPARING'
  | 'GROUP_DELIVERING'
  | 'GROUP_DELIVERED'
  // 판매자 수신
  | 'SELLER_NEW_ORDER'
  | 'SELLER_GROUP_CONFIRMED'
  | 'SELLER_ORDER_CANCELLED'
  | 'SELLER_GROUP_CANCELLED_LACK';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly aligo: AligoClient,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
  ) {}

  async getUserNotifications(userId: string) {
    const snap = await this.firestore
      .collection('notifications')
      .where('userId', '==', userId)
      .get();

    const items = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b['createdAt']?.seconds ?? 0) - (a['createdAt']?.seconds ?? 0))
      .slice(0, 50);

    return { items, total: items.length };
  }

  async updatePreferences(userId: string, preferences: Record<string, boolean>) {
    const ref = this.firestore.doc(`users/${userId}`);
    await ref.update({
      notificationPreferences: preferences,
      updatedAt: this.firestore.Timestamp.now(),
    });
    const snap = await ref.get();
    return snap.data()!['notificationPreferences'] ?? {};
  }

  async sendToUser(
    userId: string,
    templateCode: NotificationTemplateCode,
    variables: Record<string, string>,
    orderId?: string,
  ) {
    const userSnap = await this.firestore.doc(`users/${userId}`).get();
    if (!userSnap.exists) return;

    const user = userSnap.data()!;
    const phone = user['phone'] as string | null;
    if (!phone) return;

    const result = await this.aligo.sendAlimtalk(phone, templateCode, variables);
    await this.logNotification({
      userId,
      orderId: orderId ?? null,
      channel: 'alimtalk',
      templateCode,
      variables,
      phone,
      status: result.success ? 'sent' : 'failed',
      errorMessage: result.errorMessage ?? null,
    });

    if (!result.success && orderId) {
      await this.createCustomerNoticeFailedIssue(orderId, templateCode);
    }
  }

  async sendToGroupParticipants(
    productId: string,
    templateCode: NotificationTemplateCode,
    variables: Record<string, string>,
  ) {
    const snap = await this.firestore
      .collection('orders')
      .where('productId', '==', productId)
      .get();

    // PENDING·CANCELLED·REVIEWED(종료 상태) 제외 — CONFIRMED 이후 상태(PREPARING 등)도 포함
    const terminalStatuses = ['PENDING', 'CANCELLED', 'REVIEWED'];
    const promises = snap.docs
      .filter((doc) => !terminalStatuses.includes(doc.data()['status'] as string))
      .map((doc) => this.sendToUser(doc.data()['userId'], templateCode, variables, doc.id));
    await Promise.all(promises);
  }

  // 판매자(storeId 기준 ownerId 조회)에게 알림 발송
  async sendToStoreOwner(
    storeId: string,
    templateCode: NotificationTemplateCode,
    variables: Record<string, string>,
    orderId?: string,
  ) {
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists) return;

    const ownerId = storeSnap.data()!['ownerId'] as string | undefined;
    if (!ownerId) return;

    await this.sendToUser(ownerId, templateCode, variables, orderId);
  }

  // ── 선착순 마감: targetQuantity 도달 시 즉시 확정 ──
  async processGroupBuyEarlyConfirm(productId: string) {
    const gcSnap = await this.firestore.doc(`groupProductConfig/${productId}`).get();
    if (!gcSnap.exists) return;

    const gc = gcSnap.data() as Record<string, unknown>;
    if (gc['isProcessed']) return; // 이미 처리된 경우 스킵

    await this.confirmGroupBuy(productId, gc);
    await gcSnap.ref.update({ isProcessed: true });
  }

  // ── 스케줄러: 공동구매 자동 확정·취소 (매 1분) ──
  // isProcessed: true인 항목은 쿼리에서 제외하여 중복 처리 방지
  @Cron(CronExpression.EVERY_MINUTE)
  async processGroupBuyDeadlines() {
    const now = new Date();

    const expiredSnap = await this.firestore
      .collection('groupProductConfig')
      .where('recruitDeadline', '<=', this.firestore.Timestamp.fromDate(now))
      .where('isProcessed', '==', false)
      .get();

    const promises = expiredSnap.docs.map(async (gcDoc) => {
      const gc = gcDoc.data();
      const productId = gc['productId'] as string;

      if (gc['currentQuantity'] >= gc['minQuantity']) {
        await this.confirmGroupBuy(productId, gc);
      } else {
        await this.cancelGroupBuyLack(productId, gc);
      }

      // 처리 완료 플래그 설정 (중복 실행 방지)
      await gcDoc.ref.update({ isProcessed: true });
    });

    await Promise.all(promises);
  }

  // ── 스케줄러: 마감 2시간 전 알림 (매 10분) ──
  @Cron('*/10 * * * *')
  async notifyDeadlineSoon() {
    const in2h = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const in2h10 = new Date(Date.now() + 2 * 60 * 60 * 1000 + 10 * 60 * 1000);

    const snap = await this.firestore
      .collection('groupProductConfig')
      .where('recruitDeadline', '>=', this.firestore.Timestamp.fromDate(in2h))
      .where('recruitDeadline', '<=', this.firestore.Timestamp.fromDate(in2h10))
      .where('isProcessed', '==', false)
      .get();

    for (const doc of snap.docs) {
      const gc = doc.data();
      const productSnap = await this.firestore.doc(`products/${gc['productId']}`).get();
      const productName = productSnap.data()?.['name'] ?? '';

      await this.sendToGroupParticipants(gc['productId'], 'GROUP_DEADLINE_SOON', {
        productName,
        currentQuantity: String(gc['currentQuantity']),
        minQuantity: String(gc['minQuantity']),
        remaining: String((gc['minQuantity'] as number) - (gc['currentQuantity'] as number)),
      });
    }
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  private async confirmGroupBuy(productId: string, gc: Record<string, unknown>) {
    const ordersSnap = await this.firestore
      .collection('orders')
      .where('productId', '==', productId)
      .where('status', '==', 'RECRUITING')
      .get();

    if (ordersSnap.empty) return;

    const now = this.firestore.Timestamp.now();
    const batch = this.firestore.db.batch();
    ordersSnap.docs.forEach((d) => {
      batch.update(d.ref, { status: 'CONFIRMED', updatedAt: now });
    });
    await batch.commit();

    const productSnap = await this.firestore.doc(`products/${productId}`).get();
    const productName = productSnap.data()?.['name'] ?? '';
    const storeId = productSnap.data()?.['storeId'] as string | undefined;

    // 소비자 전체 알림
    await this.sendToGroupParticipants(productId, 'GROUP_CONFIRMED', {
      productName,
      minQuantity: String(gc['minQuantity']),
      groupDeliveryDate: String(gc['groupDeliveryDate']),
    });

    // 판매자 알림
    if (storeId) {
      await this.sendToStoreOwner(storeId, 'SELLER_GROUP_CONFIRMED', {
        productName,
        currentQuantity: String(gc['currentQuantity']),
      });
    }
  }

  private async cancelGroupBuyLack(productId: string, gc: Record<string, unknown>) {
    const ordersSnap = await this.firestore
      .collection('orders')
      .where('productId', '==', productId)
      .where('status', '==', 'RECRUITING')
      .get();

    if (ordersSnap.empty) return;

    const reason = '목표 수량 미달성으로 취소';
    const now = this.firestore.Timestamp.now();

    await Promise.all(
      ordersSnap.docs.map((doc) => this.payments.processRefundByOrderId(doc.id, reason)),
    );

    const batch = this.firestore.db.batch();
    ordersSnap.docs.forEach((d) => {
      batch.update(d.ref, { status: 'CANCELLED', cancelReason: reason, updatedAt: now });
    });
    await batch.commit();

    const productSnap = await this.firestore.doc(`products/${productId}`).get();
    const productName = productSnap.data()?.['name'] ?? '';
    const storeId = productSnap.data()?.['storeId'] as string | undefined;

    // 소비자 전체 알림
    await this.sendToGroupParticipants(productId, 'GROUP_CANCELLED_LACK', {
      productName,
    });

    // 판매자 알림
    if (storeId) {
      await this.sendToStoreOwner(storeId, 'SELLER_GROUP_CANCELLED_LACK', {
        productName,
        currentQuantity: String(gc['currentQuantity']),
        minQuantity: String(gc['minQuantity']),
      });
    }
  }

  private async logNotification(data: {
    userId: string;
    orderId: string | null;
    channel: string;
    templateCode: string;
    variables: Record<string, string>;
    phone: string;
    status: string;
    errorMessage: string | null;
  }) {
    const id = uuidv4();
    await this.firestore.doc(`notifications/${id}`).set({
      id,
      ...data,
      message: JSON.stringify(data.variables),
      fcmToken: null,
      sentAt: data.status === 'sent' ? this.firestore.Timestamp.now() : null,
      createdAt: this.firestore.Timestamp.now(),
    });
  }

  private async createCustomerNoticeFailedIssue(
    orderId: string,
    templateCode: NotificationTemplateCode,
  ) {
    const idempotencyKey = `customer-notice-failed:${orderId}:${templateCode}`;
    const issueId = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
    const issueRef = this.firestore.doc(`operationIssues/${issueId}`);
    const existingIssue = await issueRef.get();
    if (existingIssue.exists) return;

    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    const order = orderSnap.exists ? orderSnap.data()! : {};
    const now = this.firestore.Timestamp.now();
    await issueRef.set({
      id: issueId,
      storeId: (order['storeId'] as string | undefined) ?? '',
      orderId,
      paymentId: null,
      type: 'CUSTOMER_NOTICE_FAILED',
      status: 'OPEN',
      severity: 'warning',
      title: '고객 안내 최종 실패',
      message: '알림톡 재시도와 문자 대체가 모두 실패하여 운영 확인이 필요합니다.',
      idempotencyKey,
      latestSnapshot: {
        orderStatus: order['status'] ?? null,
        templateCode,
        failureStage: 'sms_fallback',
      },
      actions: [],
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}
