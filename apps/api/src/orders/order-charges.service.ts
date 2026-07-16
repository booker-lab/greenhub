import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { FirestoreService } from '../firestore/firestore.service';

@Injectable()
export class OrderChargesService {
  constructor(private readonly firestore: FirestoreService) {}

  async createRedeliveryFeeCharge(input: {
    storeId: string;
    orderId: string;
    requesterId: string;
    idempotencyKey: string;
  }) {
    const chargeId = this.chargeId(input);
    const orderRef = this.firestore.doc(`orders/${input.orderId}`);
    let result: Record<string, unknown> | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException('주문을 찾을 수 없습니다.');
      }
      const order = orderSnap.data()!;
      if (order['userId'] !== input.requesterId) {
        throw new ForbiddenException('주문자만 재배송비 결제를 만들 수 있습니다.');
      }
      const hold = order['deliveryHold'] as Record<string, unknown> | null | undefined;
      if (
        order['schemaVersion'] !== 2 ||
        order['status'] !== 'DELIVERY_HELD' ||
        !hold?.['customerResponsible']
      ) {
        throw new ConflictException('고객 사유 배송 보류 주문만 재배송비를 만들 수 있습니다.');
      }
      const heldAt = String(hold['heldAt'] ?? '');
      const previousChargeId = order['redeliveryChargeId'] as string | undefined;
      if (previousChargeId) {
        const previousChargeSnap = await tx.get(
          this.firestore.doc(`orderCharges/${previousChargeId}`),
        );
        if (!previousChargeSnap.exists) {
          throw new ConflictException('기존 재배송비 결제 기록을 확인할 수 없습니다.');
        }
        if (order['redeliveryChargeHoldAt'] === heldAt) {
          result = previousChargeSnap.data();
          return;
        }
        result = await this.escalateRepeatedFailure(tx, orderRef, order, input, heldAt);
        return;
      }

      const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
      const existing = await tx.get(chargeRef);
      if (existing.exists) {
        result = existing.data();
        tx.update(orderRef, {
          redeliveryChargeId: chargeId,
          redeliveryChargeHoldAt: heldAt,
          updatedAt: this.firestore.Timestamp.now(),
        });
        return;
      }
      const amount = Number(hold['redeliveryFee'] ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('재배송비 금액이 올바르지 않습니다.');
      }
      const now = this.firestore.Timestamp.now();
      result = {
        id: chargeId,
        orderId: input.orderId,
        storeId: input.storeId,
        userId: input.requesterId,
        type: 'REDELIVERY_FEE',
        status: 'PENDING',
        amount,
        reason: '고객 사유 재배송비',
        attemptNumber: 1,
        customerResponsible: true,
        portonePaymentId: null,
        idempotencyKey: input.idempotencyKey,
        paidAt: null,
        failedAt: null,
        refundedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(chargeRef, result);
      tx.update(orderRef, {
        redeliveryChargeId: chargeId,
        redeliveryChargeHoldAt: heldAt,
        updatedAt: now,
      });
    });
    return result!;
  }

  private async escalateRepeatedFailure(
    tx: any,
    orderRef: any,
    order: Record<string, unknown>,
    input: {
      storeId: string;
      orderId: string;
      requesterId: string;
      idempotencyKey: string;
    },
    heldAt: string,
  ) {
    const issueId = this.issueId(input.storeId, input.orderId);
    const issueRef = this.firestore.doc(`operationIssues/${issueId}`);
    const existingIssue = await tx.get(issueRef);
    if (existingIssue.exists) return existingIssue.data();

    const now = this.firestore.Timestamp.now();
    const issue = {
      id: issueId,
      storeId: input.storeId,
      orderId: input.orderId,
      paymentId: null,
      type: 'REDELIVERY_FAILED',
      status: 'OPEN',
      severity: 'warning',
      title: '고객 사유 재배송 실패',
      message: '유료 재배송까지 실패하여 운영 확인이 필요합니다.',
      idempotencyKey: `redelivery-failed:${input.orderId}`,
      latestSnapshot: {
        orderStatus: order['status'],
        deliveryHold: order['deliveryHold'],
        redeliveryChargeId: order['redeliveryChargeId'],
      },
      actions: [],
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(issueRef, issue);
    tx.update(orderRef, {
      redeliveryFailureIssueId: issueId,
      redeliveryFailureHoldAt: heldAt,
      requiresOperationalReview: true,
      updatedAt: now,
    });
    return issue;
  }

  private chargeId(input: {
    storeId: string;
    orderId: string;
    requesterId: string;
    idempotencyKey: string;
  }) {
    return createHash('sha256')
      .update(`${input.storeId}:${input.orderId}:${input.requesterId}:${input.idempotencyKey}`)
      .digest('hex')
      .slice(0, 32);
  }

  private issueId(storeId: string, orderId: string) {
    return createHash('sha256')
      .update(`${storeId}:${orderId}:REDELIVERY_FAILED`)
      .digest('hex')
      .slice(0, 32);
  }
}
