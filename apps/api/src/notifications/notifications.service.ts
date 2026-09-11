import { createHash } from 'node:crypto';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { PaymentsService } from '../payments/payments.service';
import { AligoClient, type ProviderOutcome } from './aligo.client';
import type { ApiNotificationTemplateCode } from './notification-templates';

export type NotificationTemplateCode = ApiNotificationTemplateCode;

export type NotificationDeliveryStatus = 'PROCESSING' | 'SENT' | 'FAILED' | 'NEEDS_VERIFY';

export const NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS = 5 * 60 * 1000;

const PROVIDER_OUTCOMES: readonly ProviderOutcome[] = ['ACCEPTED', 'REJECTED', 'UNKNOWN'];

function normalizeProviderOutcome(value: unknown, fallbackSuccess: boolean): ProviderOutcome {
  if (typeof value === 'string' && (PROVIDER_OUTCOMES as readonly string[]).includes(value)) {
    return value as ProviderOutcome;
  }
  return fallbackSuccess ? 'ACCEPTED' : 'REJECTED';
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function notificationTimestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof (value as { toMillis?: () => number })?.toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date })?.toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === 'string') return new Date(value).getTime();
  return Number.NaN;
}

function notificationDeliveryLeaseExpiryMillis(
  data: Record<string, unknown> | null | undefined,
): number {
  if (!data) return Number.NaN;
  const explicit = notificationTimestampMillis(data['leaseExpiresAt']);
  if (Number.isFinite(explicit)) return explicit;
  const updatedAt = notificationTimestampMillis(data['updatedAt']);
  if (Number.isFinite(updatedAt)) {
    return updatedAt + NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS;
  }
  return Number.NaN;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(FirestoreService)
    private readonly firestore: FirestoreService,
    @Inject(AligoClient)
    private readonly aligo: AligoClient,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
    @Inject(OperationIssueWriterService)
    private readonly issueWriter: OperationIssueWriterService,
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

  async updatePreferences(
    userId: string,
    preferences: Partial<Record<'alimtalk' | 'sms', boolean>>,
  ) {
    const ref = this.firestore.doc(`users/${userId}`);
    const current = await ref.get();
    const currentPreferences =
      (current.data()?.['notificationPreferences'] as Record<string, boolean> | undefined) ?? {};
    const nextPreferences = {
      ...currentPreferences,
      ...preferences,
    };
    await ref.update({
      notificationPreferences: nextPreferences,
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
    idempotencyKey?: string,
  ) {
    let leaseId: string | null = null;
    if (idempotencyKey) {
      leaseId = await this.claimNotificationDelivery({
        idempotencyKey,
        orderId: orderId ?? null,
        templateCode,
        userId,
      });
      if (!leaseId) {
        return;
      }
    }

    let observedOutcome: ProviderOutcome | null = null;
    let observedReceipt: string | null = null;
    let observedAttemptId: string | null = null;

    try {
      const orderSnap = orderId ? await this.firestore.doc(`orders/${orderId}`).get() : null;
      const userSnap = await this.firestore.doc(`users/${userId}`).get();
      const order = orderSnap?.exists ? orderSnap.data()! : null;
      const user = userSnap.exists ? userSnap.data()! : null;
      const phone = this.resolveRecipientPhone(userId, order, user);

      if (!phone) {
        if (orderId) {
          await this.createCustomerNoticeFailedIssue(orderId, templateCode, null);
        }
        await this.finishNotificationDelivery(idempotencyKey, 'FAILED', leaseId, {
          outcome: 'REJECTED',
          attemptId: null,
          providerReceipt: null,
        });
        return;
      }

      const raw = (await this.aligo.sendAlimtalk(phone, templateCode, variables)) as Record<
        string,
        unknown
      >;
      const fallbackSuccess = (raw as { success?: unknown })['success'] === true;
      const outcome = normalizeProviderOutcome(
        (raw as { outcome?: unknown })['outcome'],
        fallbackSuccess,
      );
      const providerReceipt =
        normalizeNullableString((raw as { providerReceipt?: unknown })['providerReceipt']);
      const attemptId =
        normalizeNullableString((raw as { attemptId?: unknown })['attemptId']) ?? uuidv4();
      const needsVerify =
        typeof (raw as { needsVerify?: unknown })['needsVerify'] === 'boolean'
          ? ((raw as { needsVerify?: boolean })['needsVerify'] as boolean)
          : outcome === 'UNKNOWN';
      const channel =
        ((raw as { channel?: unknown })['channel'] as string | null) ?? 'alimtalk';
      const message = String((raw as { message?: unknown })['message'] ?? '');
      const alimtalkAttempts = Number((raw as { alimtalkAttempts?: unknown })['alimtalkAttempts'] ?? 0);
      const smsAttempts = Number((raw as { smsAttempts?: unknown })['smsAttempts'] ?? 0);
      const errorMessage =
        typeof (raw as { errorMessage?: unknown })['errorMessage'] === 'string'
          ? ((raw as { errorMessage?: string })['errorMessage'] as string)
          : null;
      observedOutcome = outcome;
      observedReceipt = providerReceipt;
      observedAttemptId = attemptId;

      if (idempotencyKey && leaseId) {
        await this.recordDeliveryAttempt(idempotencyKey, leaseId, {
          outcome,
          providerReceipt,
          attemptId,
        });
      }

      const notificationStatus =
        outcome === 'ACCEPTED' ? 'sent' : outcome === 'UNKNOWN' ? 'pending' : 'failed';
      const notificationId = await this.logNotification({
        userId,
        orderId: orderId ?? null,
        channel,
        templateCode,
        variables,
        message,
        phone,
        status: notificationStatus,
        attemptCount: alimtalkAttempts + smsAttempts,
        errorMessage,
        attemptId,
        providerReceipt,
        providerOutcome: outcome,
        needsVerify,
        idempotencyKey: idempotencyKey ?? null,
      });

      if (outcome === 'UNKNOWN') {
        await this.finishNotificationDelivery(idempotencyKey, 'NEEDS_VERIFY', leaseId, {
          outcome,
          providerReceipt,
          attemptId,
        });
        return;
      }

      if (outcome === 'ACCEPTED') {
        await this.finishNotificationDelivery(idempotencyKey, 'SENT', leaseId, {
          outcome,
          providerReceipt,
          attemptId,
        });
        return;
      }

      if (orderId) {
        await this.createCustomerNoticeFailedIssue(orderId, templateCode, notificationId);
      }
      await this.finishNotificationDelivery(idempotencyKey, 'FAILED', leaseId, {
        outcome,
        providerReceipt,
        attemptId,
      });
    } catch (error) {
      if (observedOutcome === 'ACCEPTED') {
        await this.finishNotificationDelivery(idempotencyKey, 'SENT', leaseId, {
          outcome: 'ACCEPTED',
          providerReceipt: observedReceipt,
          attemptId: observedAttemptId,
        }).catch(() => undefined);
        throw error;
      }
      if (observedOutcome === 'UNKNOWN') {
        await this.finishNotificationDelivery(idempotencyKey, 'NEEDS_VERIFY', leaseId, {
          outcome: 'UNKNOWN',
          providerReceipt: observedReceipt,
          attemptId: observedAttemptId,
        }).catch(() => undefined);
        throw error;
      }
      await this.finishNotificationDelivery(idempotencyKey, 'FAILED', leaseId).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async resendSms(issue: Record<string, unknown>) {
    const snapshot = (issue['latestSnapshot'] as Record<string, unknown> | undefined) ?? {};
    const notificationId = snapshot['notificationId'];
    if (typeof notificationId !== 'string') {
      throw new Error('재발송할 알림 기록을 찾을 수 없습니다.');
    }
    const notificationSnap = await this.firestore.doc(`notifications/${notificationId}`).get();
    if (!notificationSnap.exists) {
      throw new Error('재발송할 알림 기록을 찾을 수 없습니다.');
    }
    const notification = notificationSnap.data()!;
    const phone = notification['phone'];
    const templateCode = notification['templateCode'];
    const variables = notification['variables'];
    if (
      typeof phone !== 'string' ||
      typeof templateCode !== 'string' ||
      !variables ||
      typeof variables !== 'object'
    ) {
      throw new Error('재발송할 알림 정보가 올바르지 않습니다.');
    }

    const raw = (await this.aligo.sendSms(
      phone,
      templateCode as NotificationTemplateCode,
      variables as Record<string, string>,
    )) as unknown as Record<string, unknown>;
    const fallbackSuccess = (raw as { success?: unknown })['success'] === true;
    const outcome = normalizeProviderOutcome(
      (raw as { outcome?: unknown })['outcome'],
      fallbackSuccess,
    );
    const providerReceipt = normalizeNullableString(
      (raw as { providerReceipt?: unknown })['providerReceipt'],
    );
    const attemptId =
      normalizeNullableString((raw as { attemptId?: unknown })['attemptId']) ?? uuidv4();
    const needsVerify =
      typeof (raw as { needsVerify?: unknown })['needsVerify'] === 'boolean'
        ? ((raw as { needsVerify?: boolean })['needsVerify'] as boolean)
        : outcome === 'UNKNOWN';
    const message = String((raw as { message?: unknown })['message'] ?? '');
    const smsAttempts = Number((raw as { smsAttempts?: unknown })['smsAttempts'] ?? 1);
    const errorMessage =
      typeof (raw as { errorMessage?: unknown })['errorMessage'] === 'string'
        ? ((raw as { errorMessage?: string })['errorMessage'] as string)
        : null;
    const originIdempotencyKey =
      typeof notification['idempotencyKey'] === 'string'
        ? (notification['idempotencyKey'] as string)
        : null;
    await this.logNotification({
      userId: String(notification['userId']),
      orderId: (notification['orderId'] as string | null) ?? null,
      channel: outcome === 'ACCEPTED' ? 'sms' : 'sms',
      templateCode,
      variables: variables as Record<string, string>,
      message,
      phone,
      status: outcome === 'ACCEPTED' ? 'sent' : outcome === 'UNKNOWN' ? 'pending' : 'failed',
      attemptCount: smsAttempts,
      errorMessage,
      attemptId,
      providerReceipt,
      providerOutcome: outcome,
      needsVerify,
      idempotencyKey: originIdempotencyKey,
      resendOfNotificationId: notificationId,
    });
    if (outcome === 'UNKNOWN') {
      throw new Error(
        errorMessage ??
          '문자 재발송 접수 여부를 확인할 수 없습니다. blind 재시도 없이 수동 확인이 필요합니다.',
      );
    }
    if (outcome !== 'ACCEPTED') {
      throw new Error(errorMessage ?? '문자 재발송에 실패했습니다.');
    }
    return {
      success: true,
      outcome,
      channel: 'sms' as const,
      message,
      alimtalkAttempts: 0,
      smsAttempts,
      providerReceipt,
      attemptId,
      needsVerify: false,
      errorMessage: undefined,
    };
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
    // LEGACY-CONSUMER-CANCEL: exclusive cancellation ownership을 가진 RECRUITING 주문은
    // group broadcast(확정/미달 취소 등)에서 제외해 claim 무시 last-write-wins와 중복 알림을 방지한다.
    const terminalStatuses = ['PENDING', 'CANCELLED', 'REVIEWED'];
    const promises = snap.docs
      .filter((doc) => !terminalStatuses.includes(doc.data()['status'] as string))
      .filter((doc) => !this.isLegacyCancellationOwned(doc.data() as Record<string, unknown>))
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

  private isLegacyCancellationOwned(order: Record<string, unknown> | null | undefined) {
    const status = (order?.['cancellation'] as Record<string, unknown> | undefined)?.[
      'status'
    ] as string | undefined;
    return (
      status === 'REFUNDING' ||
      status === 'LOCAL_PENDING' ||
      status === 'LOCAL_FAILED' ||
      status === 'REFUND_FAILED'
    );
  }

  private async confirmGroupBuy(productId: string, gc: Record<string, unknown>) {
    const ordersSnap = await this.firestore
      .collection('orders')
      .where('productId', '==', productId)
      .where('status', '==', 'RECRUITING')
      .get();

    if (ordersSnap.empty) return;

    const now = this.firestore.Timestamp.now();
    // LEGACY-CONSUMER-CANCEL: consumer cancellation claim을 무시하고 CONFIRMED로 덮어쓰지 않는다.
    // snapshot 사전 필터 + transaction fresh 재확인으로 race loser overwrite를 차단한다.
    await Promise.all(
      ordersSnap.docs.map(async (d) => {
        if (this.isLegacyCancellationOwned(d.data() as Record<string, unknown>)) return;
        await this.firestore.runTransaction(async (tx) => {
          const fresh = await tx.get(d.ref);
          if (!fresh.exists) return;
          const freshOrder = fresh.data() as Record<string, unknown>;
          if (freshOrder['status'] !== 'RECRUITING') return;
          if (this.isLegacyCancellationOwned(freshOrder)) return;
          tx.update(d.ref, { status: 'CONFIRMED', updatedAt: now });
        });
      }),
    );

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

    // LEGACY-CONSUMER-CANCEL: consumer가 exclusive ownership을 획득한 주문은
    // system refund/status 대상에서 제외한다. payment claim이 PortOne 중복을 막지만
    // status last-write-wins와 cancelReason 덮어쓰기를 transaction으로 차단한다.
    const candidates = ordersSnap.docs.filter(
      (doc) => !this.isLegacyCancellationOwned(doc.data() as Record<string, unknown>),
    );
    if (candidates.length === 0) return;

    await Promise.all(
      candidates.map((doc) => this.payments.processRefundByOrderId(doc.id, reason)),
    );

    await Promise.all(
      candidates.map(async (d) => {
        await this.firestore.runTransaction(async (tx) => {
          const fresh = await tx.get(d.ref);
          if (!fresh.exists) return;
          const freshOrder = fresh.data() as Record<string, unknown>;
          if (freshOrder['status'] !== 'RECRUITING') return;
          if (this.isLegacyCancellationOwned(freshOrder)) return;
          tx.update(d.ref, { status: 'CANCELLED', cancelReason: reason, updatedAt: now });
        });
      }),
    );

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
    message: string;
    phone: string;
    status: string;
    attemptCount: number;
    errorMessage: string | null;
    attemptId?: string | null;
    providerReceipt?: string | null;
    providerOutcome?: ProviderOutcome | null;
    needsVerify?: boolean;
    idempotencyKey?: string | null;
    resendOfNotificationId?: string | null;
  }) {
    const id = uuidv4();
    await this.firestore.doc(`notifications/${id}`).set({
      id,
      ...data,
      attemptId: data.attemptId ?? null,
      providerReceipt: data.providerReceipt ?? null,
      providerOutcome: data.providerOutcome ?? null,
      needsVerify: data.needsVerify ?? false,
      idempotencyKey: data.idempotencyKey ?? null,
      resendOfNotificationId: data.resendOfNotificationId ?? null,
      fcmToken: null,
      sentAt: data.status === 'sent' ? this.firestore.Timestamp.now() : null,
      createdAt: this.firestore.Timestamp.now(),
    });
    return id;
  }

  private async claimNotificationDelivery(input: {
    idempotencyKey: string;
    orderId: string | null;
    templateCode: NotificationTemplateCode;
    userId: string;
  }): Promise<string | null> {
    const ref = this.firestore.doc(
      `notificationDeliveries/${this.notificationDeliveryId(input.idempotencyKey)}`,
    );
    const leaseId = uuidv4();
    let acquired: string | null = null;
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.exists
        ? (snapshot.data() as Record<string, unknown>)
        : null;
      const status = (data?.['status'] as string | null | undefined) ?? null;
      // SENT is provider-accepted terminal (not device DELIVERED). Never re-dispatch.
      if (status === 'SENT') return;
      // NEEDS_VERIFY requires manual verification. Lease expiry alone must not
      // trigger blind provider redispatch.
      if (status === 'NEEDS_VERIFY') return;
      if (data?.['needsVerify'] === true) return;
      // ACCEPTED observed but SENT finalize not yet durable (e.g. crash between
      // receipt record and SENT finish). Do not blind-resend; wait for manual
      // verification instead of treating as retryable.
      if (data?.['lastOutcome'] === 'ACCEPTED') return;
      const now = this.firestore.Timestamp.now();
      const nowMillis = notificationTimestampMillis(now);
      if (!Number.isFinite(nowMillis)) return;
      if (status === 'PROCESSING') {
        const expiryMillis = notificationDeliveryLeaseExpiryMillis(data);
        // Active lease blocks reclaim. Expired lease (or legacy doc without a
        // parseable expiry, treated as expired to avoid a permanent lock) may
        // be reclaimed with a fresh lease identity.
        if (Number.isFinite(expiryMillis) && expiryMillis > nowMillis) return;
      }
      const leaseExpiresAt = new Date(
        nowMillis + NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS,
      ).toISOString();
      const previousAttempt = typeof data?.['attempt'] === 'number' ? data['attempt'] : 0;
      transaction.set(
        ref,
        {
          idempotencyKey: input.idempotencyKey,
          orderId: input.orderId,
          templateCode: input.templateCode,
          userId: input.userId,
          status: 'PROCESSING',
          leaseId,
          leaseExpiresAt,
          attempt: previousAttempt + 1,
          lastAttemptId: null,
          providerReceipt: null,
          lastOutcome: null,
          needsVerify: false,
          updatedAt: now,
          createdAt: snapshot.exists ? (data?.['createdAt'] ?? now) : now,
        },
        { merge: true },
      );
      acquired = leaseId;
    });
    return acquired;
  }

  private async recordDeliveryAttempt(
    idempotencyKey: string | undefined,
    leaseId: string | null | undefined,
    detail: {
      outcome: ProviderOutcome;
      providerReceipt: string | null;
      attemptId: string | null;
    },
  ): Promise<boolean> {
    if (!idempotencyKey) return false;
    if (typeof leaseId !== 'string' || leaseId.length === 0) return false;
    const ref = this.firestore.doc(
      `notificationDeliveries/${this.notificationDeliveryId(idempotencyKey)}`,
    );
    let recorded = false;
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const data = snapshot.data() as Record<string, unknown>;
      if (data?.['status'] !== 'PROCESSING') return;
      if (data?.['leaseId'] !== leaseId) return;
      transaction.set(
        ref,
        {
          lastAttemptId: detail.attemptId,
          providerReceipt: detail.providerReceipt,
          lastOutcome: detail.outcome,
          needsVerify: detail.outcome === 'UNKNOWN',
          updatedAt: this.firestore.Timestamp.now(),
        },
        { merge: true },
      );
      recorded = true;
    });
    return recorded;
  }

  private async finishNotificationDelivery(
    idempotencyKey: string | undefined,
    status: 'SENT' | 'FAILED' | 'NEEDS_VERIFY',
    leaseId?: string | null,
    detail?: {
      outcome?: ProviderOutcome | null;
      providerReceipt?: string | null;
      attemptId?: string | null;
    },
  ): Promise<void> {
    if (!idempotencyKey) return;
    if (typeof leaseId !== 'string' || leaseId.length === 0) return;
    const ref = this.firestore.doc(
      `notificationDeliveries/${this.notificationDeliveryId(idempotencyKey)}`,
    );
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const data = snapshot.data() as Record<string, unknown>;
      if (data?.['status'] !== 'PROCESSING') return;
      if (data?.['leaseId'] !== leaseId) return;
      const now = this.firestore.Timestamp.now();
      const patch: Record<string, unknown> = {
        status,
        updatedAt: now,
        completedAt: status === 'SENT' ? now : null,
        needsVerify: status === 'NEEDS_VERIFY',
      };
      if (detail) {
        patch['lastAttemptId'] = detail.attemptId ?? null;
        patch['providerReceipt'] = detail.providerReceipt ?? null;
        patch['lastOutcome'] =
          detail.outcome ?? (status === 'SENT' ? 'ACCEPTED' : status === 'NEEDS_VERIFY' ? 'UNKNOWN' : 'REJECTED');
      } else if (data?.['lastOutcome'] == null) {
        patch['lastOutcome'] =
          status === 'SENT' ? 'ACCEPTED' : status === 'NEEDS_VERIFY' ? 'UNKNOWN' : 'REJECTED';
      }
      transaction.set(ref, patch, { merge: true });
    });
  }

  private notificationDeliveryId(idempotencyKey: string): string {
    return createHash('sha256').update(idempotencyKey).digest('hex');
  }

  private async createCustomerNoticeFailedIssue(
    orderId: string,
    templateCode: NotificationTemplateCode,
    notificationId: string | null,
  ) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    const order = orderSnap.exists ? orderSnap.data()! : {};
    await this.issueWriter.createOrMergeIssue({
      storeId: (order['storeId'] as string | undefined) ?? '',
      orderId,
      paymentId: null,
      type: 'CUSTOMER_NOTICE_FAILED',
      status: 'OPEN',
      severity: 'warning',
      title: '고객 안내 최종 실패',
      message: '알림톡 재시도와 문자 대체가 모두 실패하여 운영 확인이 필요합니다.',
      idempotencyKey: `customer-notice-failed:${orderId}:${templateCode}`,
      latestSnapshot: {
        orderStatus: order['status'] ?? null,
        templateCode,
        notificationId,
        failureStage: 'sms_fallback',
      },
    });
  }

  private resolveRecipientPhone(
    userId: string,
    order: Record<string, unknown> | null,
    user: Record<string, unknown> | null,
  ): string | null {
    if (order?.['userId'] === userId && typeof order['deliveryPhone'] === 'string') {
      const deliveryPhone = order['deliveryPhone'].trim();
      if (deliveryPhone) return deliveryPhone;
    }
    if (typeof user?.['phone'] === 'string') {
      const profilePhone = user['phone'].trim();
      if (profilePhone) return profilePhone;
    }
    return null;
  }
}
