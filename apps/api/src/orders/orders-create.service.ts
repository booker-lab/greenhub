import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  generatePickupCode,
  detectMetropolitan,
  calcDeliveryFee,
} from './orders.helpers';

@Injectable()
export class OrdersCreateService {
  constructor(private readonly firestore: FirestoreService) {}

  async createOrder(storeId: string, userId: string, dto: CreateOrderDto) {
    // 공동구매 동의 검증
    if (dto.saleType === 'group' && !dto.groupBuyConsent?.agreed) {
      throw new BadRequestException('공동구매 동의가 필요합니다.');
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
    const buyerName: string = rawBuyerName && rawBuyerName !== '???' ? rawBuyerName : (buyerEmail.split('@')[0] || userId);
    const buyerPhone: string | null = userSnap.data()?.['phone'] ?? null;
    const sellerPhone: string | null = storeSnap.data()?.['phone'] ?? null;
    const hubData = (hubSnap as any)?.exists ? (hubSnap as any).data() : null;
    const hubName: string | null = hubData?.['name'] ?? null;
    const hubAddress: string | null = hubData
      ? ([hubData['address'], hubData['addressDetail']].filter(Boolean).join(' ') || null)
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
    const dateStr = new Date().toISOString().split('T')[0];
    const capId = `${storeId}_${dateStr}`;

    await this.firestore.runTransaction(async (t) => {
      // Daily Cap 검증 (hub/direct 배송만 슬롯 소모)
      if (dto.deliveryMethod !== 'parcel') {
        const capRef = this.firestore.doc(`dailyCaps/${capId}`);
        const capSnap = await t.get(capRef);

        // 문서 없으면 셀러가 해당 날짜 슬롯을 미설정 — 주문 차단
        if (!capSnap.exists) {
          throw new ConflictException('판매자가 해당 날짜의 배송 운영을 준비 중입니다. 택배 배송을 이용하거나 다른 날짜를 선택해주세요.');
        }
        const cap = capSnap.data()!;
        if (cap['usedSlots'] + dto.quantity > cap['totalCap']) {
          throw new ConflictException('당일 배송 슬롯이 마감되었습니다.');
        }
        t.update(capRef, {
          usedSlots: cap['usedSlots'] + dto.quantity,
        });
      }

      // 공동구매: 참여자 수 증가 + 최대 인원 검증
      if (dto.saleType === 'group') {
        const gcRef = this.firestore.doc(
          `groupProductConfig/${dto.productId}`,
        );
        const gcSnap = await t.get(gcRef);
        // 설정 문서 없으면 공동구매 자체를 허용하지 않음 (무제한 참여 방지)
        if (!gcSnap.exists) {
          throw new ConflictException('공동구매 설정을 찾을 수 없습니다.');
        }
        const gc = gcSnap.data()!;
        // Transaction 재시도 시에도 최신 값으로 재검증되므로 Race Condition 방지
        if (gc['currentParticipants'] >= gc['maxParticipants']) {
          throw new ConflictException('공동구매 모집 인원이 마감되었습니다.');
        }
        // FieldValue.increment 대신 명시적 값 사용 — Transaction 내 읽기 일관성 보장
        t.update(gcRef, {
          currentParticipants: gc['currentParticipants'] + 1,
        });
      }

      const isMetropolitan = detectMetropolitan(dto.deliveryAddress.address);

      t.set(this.firestore.doc(`orders/${orderId}`), {
        id: orderId,
        storeId,
        userId,
        productId: dto.productId,
        productName: productData['name'] as string,
        buyerName,
        address: [dto.deliveryAddress.address, dto.deliveryAddress.addressDetail].filter(Boolean).join(' '),
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
        pickupCode:
          dto.deliveryMethod === 'hub' ? generatePickupCode() : null,
        totalAmount: productData['price'] * dto.quantity + deliveryFee,
        requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
        preparedAt: null,
        cancelReason: null,
        groupBuyConsent: dto.groupBuyConsent
          ? {
              agreed: true,
              agreedAt: this.firestore.Timestamp.fromDate(
                new Date(dto.groupBuyConsent.agreedAt),
              ),
              userId,
            }
          : null,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      orderId,
      portonePaymentParams: {
        name: productData['name'],
        amount: productData['price'] * dto.quantity + deliveryFee,
        buyerName,
      },
    };
  }

  private async getDeliveryConfig(
    storeId: string,
  ): Promise<Record<string, number>> {
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
