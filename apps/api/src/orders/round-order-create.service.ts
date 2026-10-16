import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { CouponsService, type PreparedOrderCoupon } from '../coupons/coupons.service';
import { FirestoreService } from '../firestore/firestore.service';
import {
  INVISIBLE_FORMAT_CHARACTERS,
  toSingleLineText,
} from '../notifications/notification-templates';
import { RetentionService } from '../retention/retention.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { OrderCapacityService } from './order-capacity.service';
import { normalizeKoreanMobilePhone } from './_lib/korean-mobile-phone';
import { normalizeGift, resolveSelectedOptions } from './_lib/round-order-extras';

/** 쿠폰을 쓴 뒤 결제 금액 하한(원). 결제사가 0원 결제를 받지 않는다. */
export const ROUND_ORDER_MIN_PAYMENT_AMOUNT = 100;

@Injectable()
export class RoundOrderCreateService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly capacity: OrderCapacityService,
    private readonly retention: RetentionService,
    // 쿠폰(벤치마킹 비교 기능). 쿠폰 없는 주문은 쓰지 않으므로 기존 단위 테스트는 넘기지 않는다.
    private readonly coupons?: CouponsService,
  ) {}

  async create(storeId: string, userId: string, dto: CreateOrderDto) {
    this.assertRequest(dto);
    const deliveryPhone = normalizeKoreanMobilePhone(dto.deliveryPhone);
    if (!deliveryPhone) {
      throw new BadRequestException(
        '받는 분 휴대폰 번호를 확인해 주세요. 휴대폰 번호만 받을 수 있어요(예: 010-1234-5678).',
      );
    }
    const requestId = dto.clientOrderRequestId!;
    const orderId = this.stableId(storeId, userId, requestId);
    const payloadHash = this.payloadHash(storeId, userId, dto);
    const gift = normalizeGift(dto.gift);
    const orderRef = this.firestore.doc(`orders/${orderId}`);
    let result: Record<string, unknown> | null = null;

    await this.firestore.runTransaction(async (tx: any) => {
      // 읽기를 한 번에 보내 트랜잭션 시간을 줄인다(오픈 직후 같은 문서를 여러 결제가 다툰다).
      const counter = this.orderCounterRef();
      const [existingSnap, storeSnap, userSnap, counterSnap] = await Promise.all([
        tx.get(orderRef),
        tx.get(this.firestore.doc(`stores/${storeId}`)),
        tx.get(this.firestore.doc(`users/${userId}`)),
        tx.get(counter.ref),
      ]);
      if (existingSnap.exists) {
        const existing = existingSnap.data() as Record<string, any>;
        if (existing['clientOrderPayloadHash'] !== payloadHash) {
          throw new ConflictException('같은 결제 시도 ID에 다른 주문 내용이 요청되었습니다.');
        }
        result = this.response(existing);
        return;
      }

      if (!storeSnap.exists || storeSnap.data()?.['salesMode'] !== 'round_direct') {
        throw new NotFoundException('회차 주문 스토어를 찾을 수 없습니다.');
      }

      const orderCounter = {
        ...counter,
        seq: (counterSnap.exists ? counterSnap.data()?.['seq'] : 0) + 1,
      };
      // 옵션·쿠폰 확인은 읽기 단계에서 끝낸다(예약이 쓰기를 시작하면 더 읽을 수 없다).
      const optionPricing = await this.readOptionPricing(tx, storeId, dto);
      let coupon: PreparedOrderCoupon | null = null;
      if (dto.couponId) {
        if (!this.coupons) throw new BadRequestException('쿠폰을 쓸 수 없습니다.');
        coupon = await this.coupons.prepareOrderCoupon(tx, {
          storeId,
          userId,
          userCouponId: dto.couponId,
          orderAmount: optionPricing.orderAmount,
        });
      }
      const reservation = await this.capacity.reserveCheckoutInTransaction(tx, {
        storeId,
        roundId: dto.roundId!,
        userId,
        idempotencyKey: `checkout:${requestId}`,
        deliveryAddress: dto.deliveryAddress,
        items: dto.roundItems!,
      });
      const roundItems = reservation.items.map((item) => {
        const option = optionPricing.byRoundItemId.get(item.roundItemId);
        const unitPrice = item.unitPrice + (option?.priceDelta ?? 0);
        return {
          roundItemId: item.roundItemId,
          productId: item.productId,
          productName: item.productName,
          productImageUrl: item.productImageUrl,
          unitPrice,
          quantity: item.quantity,
          subtotalAmount: unitPrice * item.quantity,
          ...(option && option.selected.length > 0 ? { selectedOptions: option.selected } : {}),
        };
      });

      const now = this.firestore.Timestamp.now();
      const orderNumber = `${orderCounter.yyyymmdd}-${String(orderCounter.seq).padStart(6, '0')}`;
      const user = userSnap.data() as Record<string, any> | undefined;
      const store = storeSnap.data() as Record<string, any>;
      const buyerName = resolveOrderBuyerName(user, userId);
      const itemsAmount = roundItems.reduce((sum, item) => sum + item.subtotalAmount, 0);
      const discountAmount = coupon?.discountAmount ?? 0;
      const totalAmount = itemsAmount - discountAmount;
      if (coupon && totalAmount < ROUND_ORDER_MIN_PAYMENT_AMOUNT) {
        throw new BadRequestException('쿠폰을 쓰면 결제 금액이 너무 작아져요. 다른 쿠폰을 골라 주세요.');
      }
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
        deliveryPhone,
        requestNote: normalizeRequestNote(dto.requestNote),
        requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
        schemaVersion: 2,
        roundId: dto.roundId,
        reservationId: reservation.id,
        orderItems: roundItems,
        acquisition: dto.acquisition ?? null,
        totalAmount,
        ...(coupon
          ? { discountAmount, couponId: coupon.userCouponId, couponName: coupon.name }
          : {}),
        ...(gift ? { gift } : {}),
        createdAt: now,
        updatedAt: now,
      };
      tx.set(orderCounter.ref, { seq: orderCounter.seq, updatedAt: now }, { merge: true });
      tx.set(orderRef, order);
      coupon?.markUsed(tx, orderId);
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

  /**
   * 옵션을 고른 회차 상품의 상품 문서를 읽어 옵션 금액을 계산하고, 쿠폰 판정용 주문 금액을 구한다.
   * 회차 상품·상품 문서는 예약 단계에서 다시 읽지만, 같은 트랜잭션 안이라 값이 같다.
   */
  private async readOptionPricing(tx: any, storeId: string, dto: CreateOrderDto) {
    const byRoundItemId = new Map<string, ReturnType<typeof resolveSelectedOptions>>();
    const needsItems = Boolean(dto.couponId) || dto.roundItems!.some((item) => item.optionChoiceIds?.length);
    if (!needsItems) return { byRoundItemId, orderAmount: 0 };
    const itemSnaps = await Promise.all(
      dto.roundItems!.map((item) => tx.get(this.firestore.doc(`saleRoundItems/${item.roundItemId}`))),
    );
    const roundItems = itemSnaps.map((snap: any) => {
      const data = snap.exists ? (snap.data() as Record<string, any>) : null;
      if (!data || data['storeId'] !== storeId || data['roundId'] !== dto.roundId) {
        throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      }
      return data;
    });
    const productSnaps = await Promise.all(
      roundItems.map((item, index) =>
        dto.roundItems![index].optionChoiceIds?.length
          ? tx.get(this.firestore.doc(`products/${item['productId']}`))
          : Promise.resolve(null),
      ),
    );
    let orderAmount = 0;
    dto.roundItems!.forEach((input, index) => {
      const productSnap = productSnaps[index] as { exists: boolean; data: () => any } | null;
      const option = productSnap
        ? resolveSelectedOptions(productSnap.exists ? productSnap.data()?.['options'] : undefined, input.optionChoiceIds)
        : { selected: [], priceDelta: 0 };
      byRoundItemId.set(input.roundItemId, option);
      orderAmount += (Number(roundItems[index]['roundPrice']) + option.priceDelta) * input.quantity;
    });
    return { byRoundItemId, orderAmount };
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

  private orderCounterRef() {
    const kstDate = new Date(Date.now() + 9 * 3600 * 1000);
    const yyyymmdd = kstDate.toISOString().slice(0, 10).replace(/-/g, '');
    return { ref: this.firestore.doc(`orderCounters/${yyyymmdd}`), yyyymmdd };
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
          // 쿠폰·선물도 쓸 때만 넣어 기존 해시를 바꾸지 않는다.
          ...(dto.couponId ? { couponId: dto.couponId } : {}),
          ...(dto.gift ? { gift: dto.gift } : {}),
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
/* eslint-disable no-control-regex -- 제어문자를 제거하기 위한 패턴이다. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 제거하기 위한 패턴이다.
const REQUEST_NOTE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;
/* eslint-enable no-control-regex */

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
