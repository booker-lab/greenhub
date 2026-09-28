import type {
  Product,
  SaleRoundDeliveryRegion,
  SaleRoundItem,
  SaleRoundLimits,
  SaleRoundSchedule,
} from '@greenhub/shared';
import type { SellerSaleRound } from '@/hooks/useSaleRounds';

// 새 회차 기본값은 MVP 회차 직배송 계약을 따른다.
// - 주문 마감: 일요일 24:00(월요일 00:00) KST, 경매: 월요일 07:00, 배송: 화요일 00:00~09:00
// - 주문 시작: 마감 주 목요일 10:00 KST
// - 첫 두 회차 한도: 배송지 15곳, 판매 수량 30개 (운영 runbook §10)
// - 배송 지역: 경기도 이천시 (주문 주소 검증은 deliveryRegion.city 기준)
export const NEW_ROUND_ID = 'new';

export const DEFAULT_DELIVERY_REGION: SaleRoundDeliveryRegion = {
  id: 'icheon',
  label: '경기도 이천시',
  province: '경기도',
  city: '이천시',
  enabled: true,
};

export const DEFAULT_ROUND_LIMITS: SaleRoundLimits = {
  maxDeliveryAddresses: 15,
  maxItemQuantity: 30,
};

export const DEFAULT_ITEM_SALE_LIMIT = 10;

const HOUR_MS = 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * HOUR_MS;
// 주문 시작이 너무 임박하면 검수·예약할 시간이 없으므로 다음 주기로 넘긴다.
const MIN_LEAD_BEFORE_OPEN_MS = HOUR_MS;

/** now 이후 첫 주기의 회차 일정을 KST 규칙으로 계산한다. */
export function nextRoundSchedule(now: Date): SaleRoundSchedule {
  const nowKst = new Date(now.getTime() + KST_OFFSET_MS);
  const dayOfWeek = nowKst.getUTCDay(); // 0=일 … 6=토 (KST 기준)
  const daysUntilMonday = (8 - dayOfWeek) % 7 || 7;
  const mondayKstMidnightUtcMs =
    Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate() + daysUntilMonday) -
    KST_OFFSET_MS;

  let closeMs = mondayKstMidnightUtcMs;
  // 마감(월 00:00) 기준 3일 14시간 전 = 목요일 10:00 KST
  const openBeforeCloseMs = (3 * 24 + 14) * HOUR_MS;
  if (closeMs - openBeforeCloseMs <= now.getTime() + MIN_LEAD_BEFORE_OPEN_MS) {
    closeMs += 7 * 24 * HOUR_MS;
  }

  return {
    orderOpenAt: new Date(closeMs - openBeforeCloseMs).toISOString(),
    orderCloseAt: new Date(closeMs).toISOString(),
    auctionAt: new Date(closeMs + 7 * HOUR_MS).toISOString(),
    deliveryStartAt: new Date(closeMs + 24 * HOUR_MS).toISOString(),
    deliveryEndAt: new Date(closeMs + 33 * HOUR_MS).toISOString(),
    timezone: 'Asia/Seoul',
  };
}

/** 배송일 기준 회차 이름. 예) "10월 6일 배송 회차" */
export function defaultRoundName(schedule: SaleRoundSchedule): string {
  const deliveryKst = new Date(new Date(schedule.deliveryStartAt).getTime() + KST_OFFSET_MS);
  return `${deliveryKst.getUTCMonth() + 1}월 ${deliveryKst.getUTCDate()}일 배송 회차`;
}

/** 회차 상품 기본값: 활성 일반 판매 상품을 현재 가격으로 넣는다. 공동구매 상품은 제외한다. */
export function defaultRoundItems(
  products: readonly Product[],
  storeId: string,
  limits: SaleRoundLimits,
  nowIso: string,
): SaleRoundItem[] {
  const saleLimitQuantity = Math.min(DEFAULT_ITEM_SALE_LIMIT, limits.maxItemQuantity);
  return products
    .filter((product) => product.saleType === 'normal' && product.isActive !== false)
    .filter((product) => Number.isSafeInteger(product.price) && product.price > 0)
    .map((product, index) => ({
      id: `${NEW_ROUND_ID}-${product.id}`,
      roundId: NEW_ROUND_ID,
      storeId,
      productId: product.id,
      productNameSnapshot: product.name,
      productImageUrlSnapshot: product.images?.[0] ?? null,
      roundPrice: product.price,
      saleLimitQuantity,
      reservedQuantity: 0,
      orderedQuantity: 0,
      displayOrder: index,
      status: 'ACTIVE',
      createdAt: nowIso,
      updatedAt: nowIso,
    }));
}

/** 새 회차 양식에 넘길 저장 전 회차. 저장하면 서버가 DRAFT로 생성한다. */
export function buildNewRoundTemplate(
  products: readonly Product[],
  storeId: string,
  now: Date,
): SellerSaleRound {
  const nowIso = now.toISOString();
  const schedule = nextRoundSchedule(now);
  const limits = { ...DEFAULT_ROUND_LIMITS };
  return {
    id: NEW_ROUND_ID,
    storeId,
    name: defaultRoundName(schedule),
    status: 'DRAFT',
    closeReason: null,
    cancellation: null,
    schedule,
    deliveryRegion: { ...DEFAULT_DELIVERY_REGION },
    limits,
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    },
    carrotLandingUrl: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    items: defaultRoundItems(products, storeId, limits, nowIso),
  };
}
