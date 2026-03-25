import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { AligoClient } from './aligo.client';

export type NotificationTemplateCode =
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
  | 'GROUP_DELIVERED';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly aligo: AligoClient,
  ) {}

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
  }

  async sendToGroupParticipants(
    productId: string,
    templateCode: NotificationTemplateCode,
    variables: Record<string, string>,
  ) {
    const snap = await this.firestore
      .collection('orders')
      .where('productId', '==', productId)
      .where('status', 'in', ['RECRUITING', 'CONFIRMED'])
      .get();

    const promises = snap.docs.map((doc) =>
      this.sendToUser(
        doc.data()['userId'],
        templateCode,
        variables,
        doc.id,
      ),
    );
    await Promise.all(promises);
  }

  // ── 스케줄러 1: PENDING 주문 15분 타임아웃 처리 ──
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupPendingOrders() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const snap = await this.firestore
      .collection('orders')
      .where('status', '==', 'PENDING')
      .where('createdAt', '<', this.firestore.Timestamp.fromDate(cutoff))
      .get();

    const now = this.firestore.Timestamp.now();
    const promises = snap.docs.map(async (doc) => {
      const order = doc.data();
      await doc.ref.update({
        status: 'CANCELLED',
        cancelReason: 'timeout',
        updatedAt: now,
      });

      if (order['deliveryMethod'] !== 'parcel') {
        const dateStr = order['createdAt'].toDate().toISOString().split('T')[0];
        const capId = `${order['storeId']}_${dateStr}`;
        await this.firestore.doc(`dailyCaps/${capId}`).update({
          usedSlots: this.firestore.FieldValue.increment(-order['quantity']),
        });
      }
    });

    if (promises.length > 0) {
      await Promise.all(promises);
      console.log(`[Scheduler] PENDING 타임아웃 처리 ${promises.length}건`);
    }
  }

  // ── 스케줄러 2: 공동구매 자동 확정·취소 ──
  @Cron(CronExpression.EVERY_MINUTE)
  async processGroupBuyDeadlines() {
    const now = new Date();

    const expiredSnap = await this.firestore
      .collection('groupProductConfig')
      .where('recruitDeadline', '<=', this.firestore.Timestamp.fromDate(now))
      .get();

    for (const gcDoc of expiredSnap.docs) {
      const gc = gcDoc.data();
      const productId = gc['productId'] as string;

      if (gc['currentParticipants'] >= gc['minParticipants']) {
        // 목표 달성 → CONFIRMED 전환
        await this.confirmGroupBuy(productId, gc);
      } else {
        // 미달 → 전체 취소
        await this.cancelGroupBuyLack(productId, gc);
      }
    }
  }

  // ── 스케줄러 3: 마감 2시간 전 알림 ──
  @Cron('*/10 * * * *') // 10분마다 체크
  async notifyDeadlineSoon() {
    const in2h = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const in2h10 = new Date(Date.now() + 2 * 60 * 60 * 1000 + 10 * 60 * 1000);

    const snap = await this.firestore
      .collection('groupProductConfig')
      .where('recruitDeadline', '>=', this.firestore.Timestamp.fromDate(in2h))
      .where('recruitDeadline', '<=', this.firestore.Timestamp.fromDate(in2h10))
      .get();

    for (const doc of snap.docs) {
      const gc = doc.data();
      const productSnap = await this.firestore
        .doc(`products/${gc['productId']}`)
        .get();
      const productName = productSnap.data()?.['name'] ?? '';

      await this.sendToGroupParticipants(gc['productId'], 'GROUP_DEADLINE_SOON', {
        productName,
        currentParticipants: String(gc['currentParticipants']),
        minParticipants: String(gc['minParticipants']),
        remaining: String(gc['minParticipants'] - gc['currentParticipants']),
      });
    }
  }

  private async confirmGroupBuy(
    productId: string,
    gc: Record<string, unknown>,
  ) {
    const ordersSnap = await this.firestore
      .collection('orders')
      .where('productId', '==', productId)
      .where('status', '==', 'RECRUITING')
      .get();

    if (ordersSnap.empty) return;

    const now = this.firestore.Timestamp.now();
    const batch = this.firestore.db.batch();
    ordersSnap.docs.forEach((d) =>
      batch.update(d.ref, { status: 'CONFIRMED', updatedAt: now }),
    );
    await batch.commit();

    const productSnap = await this.firestore
      .doc(`products/${productId}`)
      .get();
    const productName = productSnap.data()?.['name'] ?? '';

    await this.sendToGroupParticipants(productId, 'GROUP_CONFIRMED', {
      productName,
      minParticipants: String(gc['minParticipants']),
      groupDeliveryDate: String(gc['groupDeliveryDate']),
    });
  }

  private async cancelGroupBuyLack(
    productId: string,
    gc: Record<string, unknown>,
  ) {
    const ordersSnap = await this.firestore
      .collection('orders')
      .where('productId', '==', productId)
      .where('status', '==', 'RECRUITING')
      .get();

    if (ordersSnap.empty) return;

    const now = this.firestore.Timestamp.now();
    const reason = '목표 수량 미달성으로 취소';

    const batch = this.firestore.db.batch();
    ordersSnap.docs.forEach((d) =>
      batch.update(d.ref, {
        status: 'CANCELLED',
        cancelReason: reason,
        updatedAt: now,
      }),
    );
    await batch.commit();

    const productSnap = await this.firestore
      .doc(`products/${productId}`)
      .get();
    const productName = productSnap.data()?.['name'] ?? '';

    await this.sendToGroupParticipants(productId, 'GROUP_CANCELLED_LACK', {
      productName,
    });
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
}
