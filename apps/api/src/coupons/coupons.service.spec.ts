import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createMemoryFirestore } from '../common/testing/memory-firestore';
import { CouponsService } from './coupons.service';

const STORE = { 'stores/store-1': { id: 'store-1', ownerId: 'seller-1' } };
const ACTIVE_COUPON = {
  id: 'coupon-1',
  storeId: 'store-1',
  name: '첫 주문 3천원',
  discountType: 'amount',
  value: 3000,
  maxDiscount: null,
  minOrderAmount: 20000,
  startsAt: null,
  endsAt: null,
  active: true,
  claimable: true,
};

function setup(extra: Record<string, any> = {}) {
  const { firestore, records } = createMemoryFirestore({ ...STORE, ...extra });
  return { service: new CouponsService(firestore as never), records };
}

describe('쿠폰(벤치마킹 비교 기능)', () => {
  it('판매자는 자기 매장 쿠폰만 만들고, 퍼센트 할인은 90%를 넘지 못한다', async () => {
    const { service } = setup();
    const created = await service.createCoupon('store-1', 'seller-1', 'seller', {
      name: '10% 할인',
      discountType: 'percent',
      value: 10,
      maxDiscount: 5000,
      minOrderAmount: 30000,
    });
    expect(created).toMatchObject({ storeId: 'store-1', discountType: 'percent', value: 10, active: true });
    await expect(
      service.createCoupon('store-1', 'other', 'seller', { ...created, value: 10 } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createCoupon('store-1', 'seller-1', 'seller', {
        name: '과한 할인',
        discountType: 'percent',
        value: 95,
        minOrderAmount: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('받기 가능한 쿠폰만 공개하고, 같은 쿠폰은 한 번만 받는다', async () => {
    const { service, records } = setup({
      'coupons/coupon-1': ACTIVE_COUPON,
      'coupons/coupon-off': { ...ACTIVE_COUPON, id: 'coupon-off', active: false },
      'coupons/coupon-ended': { ...ACTIVE_COUPON, id: 'coupon-ended', endsAt: '2020-01-01T00:00:00.000Z' },
    });
    const claimable = await service.listClaimableCoupons('store-1');
    expect(claimable.map((c) => c.id)).toEqual(['coupon-1']);

    const first = await service.claimCoupon('store-1', 'coupon-1', 'user-1');
    const second = await service.claimCoupon('store-1', 'coupon-1', 'user-1');
    expect(second.id).toBe(first.id);
    expect(records.get(`userCoupons/${first.id}`)).toMatchObject({ status: 'available', value: 3000 });
    await expect(service.claimCoupon('store-1', 'coupon-off', 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('취소된 주문에 쓴 쿠폰은 내 쿠폰 목록에서 다시 쓸 수 있게 보인다', async () => {
    const { service } = setup({
      'userCoupons/user-1_coupon-1': {
        ...ACTIVE_COUPON,
        id: 'user-1_coupon-1',
        userId: 'user-1',
        storeId: 'store-1',
        source: 'claim',
        status: 'used',
        usedOrderId: 'order-1',
        claimedAt: '2026-10-01T00:00:00.000Z',
      },
      'orders/order-1': { id: 'order-1', status: 'CANCELLED' },
    });
    const mine = await service.listMyCoupons('store-1', 'user-1');
    expect(mine[0]).toMatchObject({ status: 'available', usedOrderId: null });
  });

  it('배송 완료 주문 수로 스탬프 단계를 열고, 단계 쿠폰은 한 번만 준다', async () => {
    const orders: Record<string, any> = {};
    ['DELIVERED', 'REVIEWED', 'PICKED_UP', 'CANCELLED', 'ACCEPTED'].forEach((status, i) => {
      orders[`orders/o-${i}`] = { id: `o-${i}`, userId: 'user-1', storeId: 'store-1', status };
    });
    orders['orders/o-other'] = { id: 'o-other', userId: 'user-1', storeId: 'store-2', status: 'DELIVERED' };
    const { service } = setup(orders);
    const stamps = await service.getStamps('store-1', 'user-1');
    expect(stamps.count).toBe(3);
    expect(stamps.stages.map((s) => s.at)).toEqual([1, 3, 5, 7]);

    const reward = await service.claimStampReward('store-1', 'user-1', 3);
    expect(reward).toMatchObject({ source: 'stamp', value: 2000, status: 'available' });
    const again = await service.claimStampReward('store-1', 'user-1', 3);
    expect(again.id).toBe(reward.id);
    await expect(service.claimStampReward('store-1', 'user-1', 5)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const after = await service.getStamps('store-1', 'user-1');
    expect(after.stages.find((s) => s.at === 3)?.claimedCouponId).toBe(reward.id);
  });
});
