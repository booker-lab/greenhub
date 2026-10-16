import {
  type CouponSpec,
  couponDiscountAmount,
  type PurchaseStampsResponse,
  type StoreCoupon,
  type UserCoupon,
} from '@greenhub/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { assertStoreOwnerOrAdmin } from '../common/store-ownership';
import { FirestoreService } from '../firestore/firestore.service';
import type { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

// 팔도감 벤치마킹 비교용 쿠폰·구매 스탬프.
// - coupons/{couponId}: 판매자가 만든 쿠폰(받기 가능 여부·기간·할인)
// - userCoupons/{userCouponId}: 고객이 받은 쿠폰. 쿠폰 조건을 받을 때 복사해 둔다(나중에 판매자가 바꿔도 받은 쿠폰은 그대로).
// 쓴 쿠폰은 status=used + usedOrderId. 그 주문이 취소되면 다시 쓸 수 있는 쿠폰으로 본다(읽을 때 판정).

/** 구매 스탬프 단계. 배송 완료 주문 수가 at에 닿으면 reward 쿠폰을 한 번 받는다. */
export const PURCHASE_STAMP_STAGES: ReadonlyArray<{ at: number; reward: CouponSpec }> = [
  { at: 1, reward: { name: '첫 구매 감사 쿠폰', discountType: 'amount', value: 1000, minOrderAmount: 20000, endsAt: null } },
  { at: 3, reward: { name: '스탬프 3회 쿠폰', discountType: 'amount', value: 2000, minOrderAmount: 30000, endsAt: null } },
  { at: 5, reward: { name: '스탬프 5회 쿠폰', discountType: 'amount', value: 3000, minOrderAmount: 30000, endsAt: null } },
  { at: 7, reward: { name: '스탬프 7회 쿠폰', discountType: 'amount', value: 5000, minOrderAmount: 50000, endsAt: null } },
];

/** 스탬프로 세는 주문 상태: 배송을 마친 주문만. */
export const STAMP_ORDER_STATUSES = ['DELIVERED', 'PICKED_UP', 'REVIEWED'] as const;

/** 이 상태의 주문에 쓰였던 쿠폰은 다시 쓸 수 있다. */
const COUPON_RELEASING_ORDER_STATUSES = new Set(['CANCELLED']);

export interface PreparedOrderCoupon {
  userCouponId: string;
  name: string;
  discountAmount: number;
  /** 트랜잭션 쓰기 단계에서 호출한다. */
  markUsed: (tx: any, orderId: string) => void;
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  const v = value as { toDate?: () => Date };
  return typeof v.toDate === 'function' ? v.toDate().toISOString() : null;
}

function specOf(data: Record<string, any>): CouponSpec {
  return {
    name: data['name'],
    discountType: data['discountType'],
    value: data['value'],
    maxDiscount: data['maxDiscount'] ?? null,
    minOrderAmount: data['minOrderAmount'] ?? 0,
    endsAt: toIso(data['endsAt']),
  };
}

@Injectable()
export class CouponsService {
  constructor(private readonly firestore: FirestoreService) {}

  // ── 판매자 ──────────────────────────────────────────────

  async listStoreCoupons(storeId: string, userId: string, role?: string): Promise<StoreCoupon[]> {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const snap = await this.firestore.collection('coupons').where('storeId', '==', storeId).get();
    return snap.docs
      .map((doc: any) => this.toStoreCoupon(doc.id, doc.data()))
      .sort((a: StoreCoupon, b: StoreCoupon) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  async createCoupon(storeId: string, userId: string, role: string | undefined, dto: CreateCouponDto) {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    if (dto.discountType === 'percent' && dto.value > 90) {
      throw new BadRequestException('퍼센트 할인은 90%까지 만들 수 있습니다.');
    }
    if (dto.startsAt && dto.endsAt && Date.parse(dto.startsAt) >= Date.parse(dto.endsAt)) {
      throw new BadRequestException('쿠폰 종료 시각은 시작 시각보다 뒤여야 합니다.');
    }
    const id = randomUUID();
    const now = this.firestore.Timestamp.now();
    const doc = {
      id,
      storeId,
      name: dto.name.trim(),
      discountType: dto.discountType,
      value: dto.value,
      maxDiscount: dto.maxDiscount ?? null,
      minOrderAmount: dto.minOrderAmount,
      startsAt: dto.startsAt ?? null,
      endsAt: dto.endsAt ?? null,
      active: dto.active ?? true,
      claimable: dto.claimable ?? true,
      createdAt: now,
      updatedAt: now,
    };
    await this.firestore.doc(`coupons/${id}`).set(doc);
    return this.toStoreCoupon(id, doc);
  }

  async updateCoupon(
    storeId: string,
    couponId: string,
    userId: string,
    role: string | undefined,
    dto: UpdateCouponDto,
  ) {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const ref = this.firestore.doc(`coupons/${couponId}`);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
      throw new NotFoundException('쿠폰을 찾을 수 없습니다.');
    }
    const patch: Record<string, unknown> = { updatedAt: this.firestore.Timestamp.now() };
    if (dto.name !== undefined) patch['name'] = dto.name.trim();
    if (dto.active !== undefined) patch['active'] = dto.active;
    if (dto.claimable !== undefined) patch['claimable'] = dto.claimable;
    if (dto.endsAt !== undefined) patch['endsAt'] = dto.endsAt;
    await ref.update(patch);
    const next = await ref.get();
    return this.toStoreCoupon(couponId, next.data()!);
  }

  // ── 고객 ────────────────────────────────────────────────

  /** 지금 받을 수 있는 쿠폰(공개). */
  async listClaimableCoupons(storeId: string, now = Date.now()) {
    const snap = await this.firestore.collection('coupons').where('storeId', '==', storeId).get();
    return snap.docs
      .map((doc: any) => this.toStoreCoupon(doc.id, doc.data()))
      .filter((coupon: StoreCoupon) => this.isClaimableNow(coupon, now))
      .map((coupon: StoreCoupon) => ({
        id: coupon.id,
        name: coupon.name,
        discountType: coupon.discountType,
        value: coupon.value,
        maxDiscount: coupon.maxDiscount ?? null,
        minOrderAmount: coupon.minOrderAmount,
        endsAt: coupon.endsAt,
      }));
  }

  async claimCoupon(storeId: string, couponId: string, userId: string): Promise<UserCoupon> {
    const couponRef = this.firestore.doc(`coupons/${couponId}`);
    const userCouponId = `${userId}_${couponId}`;
    const userCouponRef = this.firestore.doc(`userCoupons/${userCouponId}`);
    let result: UserCoupon | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const [couponSnap, existingSnap] = await Promise.all([tx.get(couponRef), tx.get(userCouponRef)]);
      if (!couponSnap.exists || couponSnap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException('쿠폰을 찾을 수 없습니다.');
      }
      if (existingSnap.exists) {
        result = this.toUserCoupon(userCouponId, existingSnap.data());
        return;
      }
      const coupon = this.toStoreCoupon(couponId, couponSnap.data());
      if (!this.isClaimableNow(coupon, Date.now())) {
        throw new ConflictException('지금은 받을 수 없는 쿠폰입니다.');
      }
      const doc = {
        id: userCouponId,
        userId,
        storeId,
        couponId,
        source: 'claim',
        ...specOf(couponSnap.data()),
        status: 'available',
        usedOrderId: null,
        claimedAt: this.firestore.Timestamp.now(),
      };
      tx.set(userCouponRef, doc);
      result = this.toUserCoupon(userCouponId, doc);
    });
    return result!;
  }

  /** 내 쿠폰. 취소된 주문에 쓰였던 쿠폰은 다시 쓸 수 있는 쿠폰으로 돌려준다. */
  async listMyCoupons(storeId: string, userId: string): Promise<UserCoupon[]> {
    const snap = await this.firestore.collection('userCoupons').where('userId', '==', userId).get();
    const coupons = snap.docs
      .map((doc: any) => ({ id: doc.id as string, data: doc.data() as Record<string, any> }))
      .filter((entry: { data: Record<string, any> }) => entry.data['storeId'] === storeId);
    const result: UserCoupon[] = [];
    for (const entry of coupons) {
      const coupon = this.toUserCoupon(entry.id, entry.data);
      if (coupon.status === 'used' && coupon.usedOrderId) {
        const orderSnap = await this.firestore.doc(`orders/${coupon.usedOrderId}`).get();
        if (!orderSnap.exists || COUPON_RELEASING_ORDER_STATUSES.has(orderSnap.data()?.['status'])) {
          coupon.status = 'available';
          coupon.usedOrderId = null;
        }
      }
      result.push(coupon);
    }
    return result.sort((a, b) => b.claimedAt.localeCompare(a.claimedAt));
  }

  /**
   * 주문 트랜잭션의 읽기 단계에서 부른다. 쿠폰이 이 고객·매장 것이고 쓸 수 있는지 확인하고
   * 할인액을 계산한다. 쓰기(markUsed)는 주문을 쓰는 단계에서 호출한다.
   */
  async prepareOrderCoupon(
    tx: any,
    input: { storeId: string; userId: string; userCouponId: string; orderAmount: number; now?: number },
  ): Promise<PreparedOrderCoupon> {
    const ref = this.firestore.doc(`userCoupons/${input.userCouponId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new NotFoundException('쿠폰을 찾을 수 없습니다.');
    const data = snap.data() as Record<string, any>;
    if (data['userId'] !== input.userId || data['storeId'] !== input.storeId) {
      throw new NotFoundException('쿠폰을 찾을 수 없습니다.');
    }
    if (data['status'] === 'used' && data['usedOrderId']) {
      const orderSnap = await tx.get(this.firestore.doc(`orders/${data['usedOrderId']}`));
      if (orderSnap.exists && !COUPON_RELEASING_ORDER_STATUSES.has(orderSnap.data()?.['status'])) {
        throw new ConflictException('이미 사용한 쿠폰입니다.');
      }
    }
    const discountAmount = couponDiscountAmount(specOf(data), input.orderAmount, input.now);
    if (discountAmount <= 0) {
      throw new BadRequestException('쿠폰 사용 조건(최소 주문 금액·기간)을 확인해 주세요.');
    }
    return {
      userCouponId: input.userCouponId,
      name: data['name'],
      discountAmount,
      markUsed: (writeTx: any, orderId: string) => {
        writeTx.update(ref, {
          status: 'used',
          usedOrderId: orderId,
          usedAt: this.firestore.Timestamp.now(),
        });
      },
    };
  }

  // ── 구매 스탬프 ─────────────────────────────────────────

  async getStamps(storeId: string, userId: string): Promise<PurchaseStampsResponse> {
    const count = await this.countStampOrders(storeId, userId);
    const claimed = await this.claimedStampCouponIds(storeId, userId);
    return {
      count,
      stages: PURCHASE_STAMP_STAGES.map((stage) => ({
        at: stage.at,
        reward: stage.reward,
        claimedCouponId: claimed.get(stage.at) ?? null,
      })),
    };
  }

  async claimStampReward(storeId: string, userId: string, at: number): Promise<UserCoupon> {
    const stage = PURCHASE_STAMP_STAGES.find((s) => s.at === at);
    if (!stage) throw new NotFoundException('스탬프 단계를 찾을 수 없습니다.');
    const count = await this.countStampOrders(storeId, userId);
    if (count < stage.at) throw new ConflictException('아직 받을 수 없는 스탬프 쿠폰입니다.');
    const userCouponId = `${userId}_stamp_${storeId}_${stage.at}`;
    const ref = this.firestore.doc(`userCoupons/${userCouponId}`);
    let result: UserCoupon | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        result = this.toUserCoupon(userCouponId, snap.data());
        return;
      }
      const doc = {
        id: userCouponId,
        userId,
        storeId,
        couponId: null,
        stampAt: stage.at,
        source: 'stamp',
        ...stage.reward,
        maxDiscount: stage.reward.maxDiscount ?? null,
        status: 'available',
        usedOrderId: null,
        claimedAt: this.firestore.Timestamp.now(),
      };
      tx.set(ref, doc);
      result = this.toUserCoupon(userCouponId, doc);
    });
    return result!;
  }

  private async countStampOrders(storeId: string, userId: string): Promise<number> {
    // userId 단일 조건만 써서 새 복합 색인 없이 읽는다.
    const snap = await this.firestore.collection('orders').where('userId', '==', userId).get();
    return snap.docs.filter((doc: any) => {
      const order = doc.data();
      return (
        order['storeId'] === storeId &&
        (STAMP_ORDER_STATUSES as readonly string[]).includes(order['status'])
      );
    }).length;
  }

  private async claimedStampCouponIds(storeId: string, userId: string): Promise<Map<number, string>> {
    const snap = await this.firestore.collection('userCoupons').where('userId', '==', userId).get();
    const claimed = new Map<number, string>();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data['storeId'] === storeId && data['source'] === 'stamp' && typeof data['stampAt'] === 'number') {
        claimed.set(data['stampAt'], doc.id);
      }
    }
    return claimed;
  }

  // ── 변환 ────────────────────────────────────────────────

  private isClaimableNow(coupon: StoreCoupon, now: number): boolean {
    if (!coupon.active || !coupon.claimable) return false;
    if (coupon.startsAt && Date.parse(coupon.startsAt) > now) return false;
    if (coupon.endsAt && Date.parse(coupon.endsAt) < now) return false;
    return true;
  }

  private toStoreCoupon(id: string, data: Record<string, any>): StoreCoupon {
    return {
      id,
      storeId: data['storeId'],
      ...specOf(data),
      active: data['active'] !== false,
      claimable: data['claimable'] !== false,
      startsAt: toIso(data['startsAt']),
      createdAt: toIso(data['createdAt']) ?? undefined,
      updatedAt: toIso(data['updatedAt']) ?? undefined,
    };
  }

  private toUserCoupon(id: string, data: Record<string, any>): UserCoupon {
    return {
      id,
      storeId: data['storeId'],
      couponId: typeof data['couponId'] === 'string' ? data['couponId'] : null,
      source: data['source'] === 'stamp' ? 'stamp' : 'claim',
      ...specOf(data),
      status: data['status'] === 'used' ? 'used' : 'available',
      usedOrderId: data['usedOrderId'] ?? null,
      claimedAt: toIso(data['claimedAt']) ?? '',
    };
  }
}
