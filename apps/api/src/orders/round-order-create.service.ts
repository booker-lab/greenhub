import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { FirestoreService } from '../firestore/firestore.service';
import { RetentionService } from '../retention/retention.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { OrderCapacityService } from './order-capacity.service';

@Injectable()
export class RoundOrderCreateService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly capacity: OrderCapacityService,
    private readonly retention: RetentionService,
  ) {}

  async create(storeId: string, userId: string, dto: CreateOrderDto) {
    this.assertRequest(dto);
    const requestId = dto.clientOrderRequestId!;
    const orderId = this.stableId(storeId, userId, requestId);
    const payloadHash = this.payloadHash(storeId, userId, dto);
    const orderRef = this.firestore.doc(`orders/${orderId}`);
    let result: Record<string, unknown> | null = null;

    await this.firestore.runTransaction(async (tx: any) => {
      const existingSnap = await tx.get(orderRef);
      if (existingSnap.exists) {
        const existing = existingSnap.data() as Record<string, any>;
        if (existing['clientOrderPayloadHash'] !== payloadHash) {
          throw new ConflictException('같은 결제 시도 ID에 다른 주문 내용이 요청되었습니다.');
        }
        result = this.response(existing);
        return;
      }

      const [storeSnap, userSnap] = await Promise.all([
        tx.get(this.firestore.doc(`stores/${storeId}`)),
        tx.get(this.firestore.doc(`users/${userId}`)),
      ]);
      if (!storeSnap.exists || storeSnap.data()?.['salesMode'] !== 'round_direct') {
        throw new NotFoundException('회차 주문 스토어를 찾을 수 없습니다.');
      }

      const orderCounter = await this.nextOrderNumber(tx);
      const reservation = await this.capacity.reserveCheckoutInTransaction(tx, {
        storeId,
        roundId: dto.roundId!,
        userId,
        idempotencyKey: `checkout:${requestId}`,
        deliveryAddress: dto.deliveryAddress,
        items: dto.roundItems!,
      });
      const roundItems = reservation.items.map((item) => ({
        roundItemId: item.roundItemId,
        productId: item.productId,
        productName: item.productName,
        productImageUrl: item.productImageUrl,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotalAmount: item.unitPrice * item.quantity,
      }));

      const now = this.firestore.Timestamp.now();
      const orderNumber = `${orderCounter.yyyymmdd}-${String(orderCounter.seq).padStart(6, '0')}`;
      const user = userSnap.data() as Record<string, any> | undefined;
      const store = storeSnap.data() as Record<string, any>;
      const buyerEmail = user?.['email'] ?? '';
      const rawBuyerName = user?.['name'] ?? '';
      const buyerName =
        rawBuyerName && rawBuyerName !== '???' ? rawBuyerName : buyerEmail.split('@')[0] || userId;
      const totalAmount = roundItems.reduce((sum, item) => sum + item.subtotalAmount, 0);
      const order = {
        id: orderId,
        orderNumber,
        clientOrderRequestId: requestId,
        clientOrderPayloadHash: payloadHash,
        storeId,
        userId,
        productId: roundItems[0].productId,
        productName: roundItems[0].productName,
        buyerName,
        buyerPhone: user?.['phone'] ?? null,
        sellerPhone: store['phone'] ?? null,
        address: [dto.deliveryAddress.address, dto.deliveryAddress.addressDetail]
          .filter(Boolean)
          .join(' '),
        quantity: reservation.itemQuantityTotal,
        saleType: 'normal',
        status: 'PENDING',
        deliveryMethod: 'direct',
        deliveryFee: 0,
        deliveryAddress: dto.deliveryAddress,
        deliveryPhone: dto.deliveryPhone,
        requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
        schemaVersion: 2,
        roundId: dto.roundId,
        reservationId: reservation.id,
        orderItems: roundItems,
        acquisition: dto.acquisition ?? null,
        marketingConsent: dto.marketingConsent ?? null,
        totalAmount,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(orderCounter.ref, { seq: orderCounter.seq, updatedAt: now }, { merge: true });
      tx.set(orderRef, order);
      await this.retention.saveRecord({
        id: `${orderId}:contract`,
        purpose: 'LEGAL_ORDER',
        basisAt: this.toDate(now),
        metadata: {
          orderId,
          storeId,
          userId,
          recordTypes: ['CONTRACT', 'SUPPLY'],
          amount: totalAmount,
          orderStatus: 'PENDING',
        },
        transaction: tx,
      });
      if (dto.marketingConsent) {
        const consent = dto.marketingConsent;
        await this.retention.saveRecord({
          id: `${orderId}:marketing-consent`,
          purpose: 'MARKETING_CONSENT',
          basisAt: consent.agreedAt ? new Date(consent.agreedAt) : this.toDate(now),
          metadata: {
            orderId,
            userId,
            agreed: consent.agreed,
            channels: consent.channels,
            policyVersion: consent.copyVersion,
            recordType: 'CONSENT',
          },
          transaction: tx,
        });
      }
      result = this.response(order);
    });

    return result!;
  }

  private assertRequest(dto: CreateOrderDto) {
    if (!dto.clientOrderRequestId) {
      throw new BadRequestException('회차 주문 결제 시도 ID가 필요합니다.');
    }
    if (dto.deliveryMethod !== 'direct') {
      throw new BadRequestException('회차 주문은 직접배송만 가능합니다.');
    }
    if (!dto.roundId || !dto.roundItems?.length) {
      throw new BadRequestException('회차 주문 상품이 필요합니다.');
    }
    const itemIds = dto.roundItems.map((item) => item.roundItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException('같은 회차 상품을 중복으로 주문할 수 없습니다.');
    }
  }

  private response(order: Record<string, any>) {
    const items = order['orderItems'] as Array<Record<string, any>>;
    return {
      orderId: order['id'],
      orderNumber: order['orderNumber'],
      reservationId: order['reservationId'],
      portonePaymentParams: {
        name: items.length === 1 ? items[0]['productName'] : `${items[0]['productName']} 외`,
        amount: order['totalAmount'],
        buyerName: order['buyerName'],
      },
    };
  }

  private async nextOrderNumber(tx: any) {
    const kstDate = new Date(Date.now() + 9 * 3600 * 1000);
    const yyyymmdd = kstDate.toISOString().slice(0, 10).replace(/-/g, '');
    const counterRef = this.firestore.doc(`orderCounters/${yyyymmdd}`);
    const counterSnap = await tx.get(counterRef);
    const seq = (counterSnap.exists ? counterSnap.data()?.['seq'] : 0) + 1;
    return { ref: counterRef, seq, yyyymmdd };
  }

  private stableId(storeId: string, userId: string, requestId: string) {
    return createHash('sha256')
      .update(`${storeId}:${userId}:${requestId}`)
      .digest('hex')
      .slice(0, 32);
  }

  private payloadHash(storeId: string, userId: string, dto: CreateOrderDto) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          storeId,
          userId,
          roundId: dto.roundId,
          items: dto.roundItems,
          deliveryAddress: dto.deliveryAddress,
          deliveryPhone: dto.deliveryPhone,
          requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
          acquisition: dto.acquisition ?? null,
          marketingConsent: dto.marketingConsent ?? null,
        }),
      )
      .digest('hex');
  }

  private toDate(value: { toDate?: () => Date } | Date): Date {
    return value instanceof Date ? value : value.toDate!();
  }
}
