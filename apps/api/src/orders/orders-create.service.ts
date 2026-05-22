import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { generatePickupCode, detectMetropolitan, calcDeliveryFee } from './orders.helpers';

@Injectable()
export class OrdersCreateService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly notifications: NotificationsService,
  ) {}

  async createOrder(storeId: string, userId: string, dto: CreateOrderDto) {
    // 공동구매 동의 검증
    if (dto.saleType === 'group' && !dto.groupBuyConsent?.agreed) {
      throw new BadRequestException('공동구매 동의가 필요합니다.');
    }

    // 공동구매 중복 참여 방지
    if (dto.saleType === 'group') {
      const existingSnap = await this.firestore
        .collection('orders')
        .where('userId', '==', userId)
        .where('productId', '==', dto.productId)
        .where('saleType', '==', 'group')
        .get();
      const hasActive = existingSnap.docs.some((d) => d.data()['status'] !== 'CANCELLED');
      if (hasActive) {
        throw new ConflictException('이미 참여 중인 공동구매입니다.');
      }
    }

    // hub 배송 시 hubId 필수
    if (dto.deliveryMethod === 'hub' && !dto.hubId) {
      throw new BadRequestException('거점 배송 시 hubId가 필요합니다.');
    }

    const [product, userSnap, storeSnap, hubSnap] = await Promise.all([
      this.firestore.doc(`products/${dto.productId}`).get(),
      this.firestore.doc(`users/${userId}`).get(),
      this.firestore.doc(`stores/${storeId}`).get(),
      dto.hubId ? this.firestore.doc(`hubs/${dto.hubId}`).get() : Promise.resolve(null),
    ]);
    if (!product.exists || product.data()!['storeId'] !== storeId) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    const productData = product.data()!;
    const rawBuyerName: string = userSnap.data()?.['name'] ?? '';
    const buyerEmail: string = userSnap.data()?.['email'] ?? '';
    const buyerName: string =
      rawBuyerName && rawBuyerName !== '???' ? rawBuyerName : buyerEmail.split('@')[0] || userId;
    const buyerPhone: string | null = userSnap.data()?.['phone'] ?? null;
    const sellerPhone: string | null = storeSnap.data()?.['phone'] ?? null;
    const hubData = (hubSnap as any)?.exists ? (hubSnap as any).data() : null;
    const hubName: string | null = hubData?.['name'] ?? null;
    const hubAddress: string | null = hubData
      ? [hubData['address'], hubData['addressDetail']].filter(Boolean).join(' ') || null
      : null;

    // 배송비 계산
    const deliveryConfig = await this.getDeliveryConfig(storeId);
    const deliveryFee = calcDeliveryFee(
      dto.deliveryMethod,
      productData['deliverySize'],
      productData['price'] * dto.quantity,
      deliveryConfig,
    );

    const orderId = uuidv4();
    const now = this.firestore.Timestamp.now();

    // T8: orderNumber 발급 — 카운터 read는 트랜잭션 첫 read로 배치 (write 전 read 규칙 준수)
    const kstDate = new Date(Date.now() + 9 * 3600 * 1000);
    const yyyymmdd = kstDate.toISOString().slice(0, 10).replace(/-/g, '');
    const counterRef = this.firestore.doc(`orderCounters/${yyyymmdd}`);

    let orderNumber = '';

    await this.firestore.runTransaction(async (t) => {
      // T8: 일자별 카운터 read (모든 write 이전에 수행)
      const counterSnap = await t.get(counterRef);
      const seq = (counterSnap.exists ? (counterSnap.data()!['seq'] as number) : 0) + 1;
      orderNumber = `${yyyymmdd}-${String(seq).padStart(6, '0')}`;

      // Daily Cap 검증 (hub/direct 배송만 슬롯 소모, 공동구매 제외)
      if (dto.deliveryMethod !== 'parcel' && dto.saleType !== 'group') {
        // DTO ValidateIf로 같은 분기에서 필수화됨 — 미도달 시 400으로 사전 차단
        const dateStr = dto.requestedDeliveryDate!;
        const capId = `${storeId}_${dateStr}`;
        const capRef = this.firestore.doc(`dailyCaps/${capId}`);
        const capSnap = await t.get(capRef);

        // 문서 없으면 셀러가 해당 날짜 슬롯을 미설정 — 주문 차단
        if (!capSnap.exists) {
          throw new ConflictException(
            '판매자가 해당 날짜의 배송 운영을 준비 중입니다. 택배 배송을 이용하거나 다른 날짜를 선택해주세요.',
          );
        }
        const cap = capSnap.data()!;
        if (cap['usedSlots'] + dto.quantity > cap['totalCap']) {
          throw new ConflictException('당일 배송 슬롯이 마감되었습니다.');
        }
        t.update(capRef, {
          usedSlots: cap['usedSlots'] + dto.quantity,
        });
      }

      // 공동구매: 수량 누적 + 목표 수량·maxPerPerson 검증
      if (dto.saleType === 'group') {
        const gcRef = this.firestore.doc(`groupProductConfig/${dto.productId}`);
        const gcSnap = await t.get(gcRef);
        // 설정 문서 없으면 공동구매 자체를 허용하지 않음 (무제한 참여 방지)
        if (!gcSnap.exists) {
          throw new ConflictException('공동구매 설정을 찾을 수 없습니다.');
        }
        const gc = gcSnap.data()!;

        // 1인 최대 구매 수량 초과 검증
        if (dto.quantity > (gc['maxPerPerson'] as number)) {
          throw new BadRequestException(
            `1인 최대 구매 수량(${gc['maxPerPerson']}개)을 초과할 수 없습니다.`,
          );
        }

        // Transaction 재시도 시에도 최신 값으로 재검증되므로 Race Condition 방지
        if (gc['currentQuantity'] >= gc['targetQuantity']) {
          throw new ConflictException('공동구매 목표 수량이 마감되었습니다.');
        }
        // FieldValue.increment 대신 명시적 값 사용 — Transaction 내 읽기 일관성 보장
        const newQuantity = (gc['currentQuantity'] as number) + dto.quantity;
        t.update(gcRef, { currentQuantity: newQuantity });

        // 선착순 마감: 트랜잭션 외부에서 조기 확정 트리거 (비동기, 실패 무시)
        if (newQuantity >= (gc['targetQuantity'] as number)) {
          setImmediate(() => {
            this.notifications
              .processGroupBuyEarlyConfirm(dto.productId)
              .catch((err) => console.error('[GroupBuy] 조기 확정 트리거 실패', err));
          });
        }
      }

      const isMetropolitan = detectMetropolitan(dto.deliveryAddress.address);

      // T8: 카운터 증가분 commit (read 이후 write)
      t.set(counterRef, { seq, updatedAt: now }, { merge: true });

      t.set(this.firestore.doc(`orders/${orderId}`), {
        id: orderId,
        orderNumber,
        storeId,
        userId,
        productId: dto.productId,
        productName: productData['name'] as string,
        buyerName,
        address: [dto.deliveryAddress.address, dto.deliveryAddress.addressDetail]
          .filter(Boolean)
          .join(' '),
        buyerPhone,
        sellerPhone,
        hubName,
        hubAddress,
        quantity: dto.quantity,
        saleType: dto.saleType,
        status: 'PENDING',
        deliveryMethod: dto.deliveryMethod,
        deliveryFee,
        deliveryAddress: dto.deliveryAddress,
        isMetropolitan,
        hubId: dto.deliveryMethod === 'hub' ? (dto.hubId ?? null) : null,
        pickupCode: dto.deliveryMethod === 'hub' ? generatePickupCode() : null,
        totalAmount: productData['price'] * dto.quantity + deliveryFee,
        requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
        preparedAt: null,
        cancelReason: null,
        groupBuyConsent: dto.groupBuyConsent
          ? {
              agreed: true,
              agreedAt: this.firestore.Timestamp.fromDate(new Date(dto.groupBuyConsent.agreedAt)),
              userId,
            }
          : null,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      orderId,
      orderNumber,
      portonePaymentParams: {
        name: productData['name'],
        amount: productData['price'] * dto.quantity + deliveryFee,
        buyerName,
      },
    };
  }

  private async getDeliveryConfig(storeId: string): Promise<Record<string, number>> {
    const snap = await this.firestore.doc(`deliveryFeeConfig/${storeId}`).get();
    if (snap.exists) return snap.data() as Record<string, number>;
    // 문서 없는 경우 기본값 (신규 스토어 또는 미설정 시)
    return {
      directFee: 3000,
      hubFee: 1000,
      parcelFee: 4000,
      freeThresholdDirect: 50000,
      freeThresholdHub: 30000,
      freeThresholdParcel: 50000,
    };
  }
}
