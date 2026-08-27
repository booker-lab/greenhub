import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import {
  isChargeForCurrentHold,
  isCurrentRedeliveryPaymentRequired,
} from './redelivery-resume-gate';

@Injectable()
export class OrderChargesService {
  constructor(
    @Inject(FirestoreService)
    private readonly firestore: FirestoreService,
    @Inject(OperationIssueWriterService)
    private readonly issueWriter: OperationIssueWriterService,
  ) {}

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
        !hold ||
        order['schemaVersion'] !== 2 ||
        !['DELIVERY_HELD', 'PREPARING'].includes(String(order['status'])) ||
        hold['reasonCode'] === 'WEATHER' ||
        !isCurrentRedeliveryPaymentRequired({ ...order, id: input.orderId })
      ) {
        throw new ConflictException('고객 사유 배송 보류 주문만 재배송비를 만들 수 있습니다.');
      }
      const heldAt = String(hold['heldAt'] ?? '');
      if (heldAt.trim().length === 0) {
        throw new ConflictException('현재 배송 보류의 식별자를 확인할 수 없습니다.');
      }
      const previousChargeId = order['redeliveryChargeId'] as string | undefined;
      if (!previousChargeId && order['redeliveryChargeHoldAt'] != null) {
        throw new ConflictException('재배송비 결제 연결이 손상되었습니다.');
      }
      if (previousChargeId) {
        const previousChargeSnap = await tx.get(
          this.firestore.doc(`orderCharges/${previousChargeId}`),
        );
        if (!previousChargeSnap.exists) {
          throw new ConflictException('기존 재배송비 결제 기록을 확인할 수 없습니다.');
        }
        if (order['redeliveryChargeHoldAt'] === heldAt) {
          const previousCharge = previousChargeSnap.data()!;
          if (
            !isChargeForCurrentHold(
              { ...order, id: input.orderId },
              previousCharge,
              previousChargeId,
            )
          ) {
            throw new ConflictException('현재 배송 보류와 기존 결제 기록이 일치하지 않습니다.');
          }
          result = this.withPaymentParams(previousCharge);
          return;
        }
        result = await this.escalateRepeatedFailure(tx, orderRef, order, input, heldAt);
        return;
      }

      const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);
      const existing = await tx.get(chargeRef);
      if (existing.exists) {
        const existingCharge = existing.data()!;
        if (!isChargeForCurrentHold({ ...order, id: input.orderId }, existingCharge, chargeId)) {
          throw new ConflictException('기존 결제 기록이 현재 배송 보류와 일치하지 않습니다.');
        }
        result = this.withPaymentParams(existingCharge);
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
      const portonePaymentId = `order-charge-${chargeId}`;
      const charge = {
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
        holdAt: heldAt,
        portonePaymentId,
        idempotencyKey: input.idempotencyKey,
        paidAt: null,
        failedAt: null,
        refundedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      result = this.withPaymentParams(charge);
      tx.set(chargeRef, charge);
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
    const now = this.firestore.Timestamp.now();
    const issue = await this.issueWriter.createOrMergeIssue(
      {
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
          redeliveryChargeId: order['redeliveryChargeId'],
          failureStage: 'paid_redelivery_failed',
        },
      },
      tx,
    );
    tx.update(orderRef, {
      redeliveryFailureIssueId: issue.id,
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

  private withPaymentParams(charge: Record<string, any>) {
    return {
      ...charge,
      portonePaymentParams: {
        paymentId: charge['portonePaymentId'],
        amount: charge['amount'],
        name: charge['reason'],
      },
    };
  }
}
