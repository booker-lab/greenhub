import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { FirestoreService } from '../firestore/firestore.service';

@Injectable()
export class OrderChargesService {
  constructor(private readonly firestore: FirestoreService) {}

  async createRedeliveryFeeCharge(input: {
    storeId: string;
    orderId: string;
    idempotencyKey: string;
  }) {
    const chargeId = this.chargeId(input.idempotencyKey);
    const chargeRef = this.firestore.doc(`orderCharges/${chargeId}`);

    const existing = await chargeRef.get();
    if (existing.exists) return existing.data();

    const orderSnap = await this.firestore.doc(`orders/${input.orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }

    const order = orderSnap.data()!;
    const hold = order['deliveryHold'] as Record<string, unknown> | null | undefined;
    if (order['status'] !== 'DELIVERY_HELD' || !hold?.['customerResponsible']) {
      throw new ConflictException('고객 사유 배송 보류 주문만 재배송비를 만들 수 있습니다.');
    }

    const amount = Number(hold['redeliveryFee'] ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('재배송비 금액이 올바르지 않습니다.');
    }

    const now = this.firestore.Timestamp.now();
    const charge = {
      id: chargeId,
      orderId: input.orderId,
      storeId: input.storeId,
      userId: order['userId'] ?? null,
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

    await chargeRef.set(charge);
    return charge;
  }

  private chargeId(idempotencyKey: string) {
    return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  }
}
