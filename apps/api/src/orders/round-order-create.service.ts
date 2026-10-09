import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { FirestoreService } from '../firestore/firestore.service';
import {
  INVISIBLE_FORMAT_CHARACTERS,
  toSingleLineText,
} from '../notifications/notification-templates';
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
      const buyerName = resolveOrderBuyerName(user, userId);
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
        requestNote: normalizeRequestNote(dto.requestNote),
        requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
        schemaVersion: 2,
        roundId: dto.roundId,
        reservationId: reservation.id,
        orderItems: roundItems,
        acquisition: dto.acquisition ?? null,
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
    if (dto.marketingConsent) {
      throw new BadRequestException('파일럿에서는 마케팅 동의를 수집하지 않습니다.');
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
    const requestNote = normalizeRequestNote(dto.requestNote);
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
          // 요청사항이 없으면 필드 자체를 빼서 기존 결제 시도의 해시를 유지한다.
          ...(requestNote !== null ? { requestNote } : {}),
        }),
      )
      .digest('hex');
  }

  private toDate(value: { toDate?: () => Date } | Date): Date {
    return value instanceof Date ? value : value.toDate!();
  }
}

// 요청사항은 줄바꿈을 LF로 맞추고 앞뒤 공백을 지운다. 비어 있으면 null로 저장한다.
// 주문에 복사하는 구매자 표시 이름의 최대 글자 수. 프로필 이름 입력 상한과 같다.
export const ORDER_BUYER_NAME_MAX_LENGTH = 20;

/**
 * 사용자 프로필에서 주문의 buyerName을 만든다. 이름은 한 줄로 정리하고 상한으로 자르며,
 * 비어 있거나 '???'이면 이메일 앞부분, 그것도 없으면 userId를 쓴다.
 */
export function resolveOrderBuyerName(
  user: Record<string, unknown> | undefined,
  userId: string,
): string {
  const name = toSingleLineText(user?.['name'], ORDER_BUYER_NAME_MAX_LENGTH);
  if (name && name !== '???') return name;
  const email = typeof user?.['email'] === 'string' ? user['email'] : '';
  return toSingleLineText(email.split('@')[0], ORDER_BUYER_NAME_MAX_LENGTH) || userId;
}

// 요청사항은 여러 줄을 허용하되 줄바꿈 외 제어문자와 보이지 않는 서식 문자는 저장하지 않는다.
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 제거하기 위한 패턴이다.
const REQUEST_NOTE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;

export function normalizeRequestNote(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE_FORMAT_CHARACTERS, '')
    .replace(REQUEST_NOTE_CONTROL_CHARACTERS, '')
    .trim();
  return normalized.length > 0 ? normalized : null;
}
