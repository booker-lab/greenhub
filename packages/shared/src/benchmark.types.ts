// 팔도감 벤치마킹 비교용 기능의 공개 계약. 모든 필드는 선택이라 기존 데이터·응답과 호환된다.
// 기능 토글은 features.ts를 따른다.

// ── 상품 추가 정보 ─────────────────────────────────────────────

/** 크기 정보. 사진만으로 크기를 짐작하기 어려운 문제를 줄인다. */
export interface ProductSize {
  heightCm?: number
  widthCm?: number
  potDiameterCm?: number
  /** 꽃 송이 수(대략) */
  bloomCount?: number
}

export const LIGHT_LEVELS = ['bright', 'medium', 'low'] as const
export type LightLevel = (typeof LIGHT_LEVELS)[number]
export const LIGHT_LABELS: Record<LightLevel, string> = {
  bright: '밝은 곳',
  medium: '반그늘',
  low: '그늘에서도',
}

export const PLACEMENTS = ['living', 'office', 'bedroom', 'store'] as const
export type Placement = (typeof PLACEMENTS)[number]
export const PLACEMENT_LABELS: Record<Placement, string> = {
  living: '거실',
  office: '사무실',
  bedroom: '침실',
  store: '매장·개업',
}

export const CURATIONS = ['gift', 'monthly'] as const
export type Curation = (typeof CURATIONS)[number]
export const CURATION_LABELS: Record<Curation, string> = {
  gift: '선물용',
  monthly: '이달의 꽃',
}

/** 관리 안내 카드. 각 항목은 한두 문장. */
export interface CareGuide {
  watering: string
  light: string
  temperature: string
  repotting: string
}

export interface ProductOptionChoice {
  id: string
  label: string
  /** 회차 가격에 더하는 금액(원). 0 이상. */
  priceDelta: number
}

/** 옵션 묶음. 묶음마다 선택지 하나를 고른다. */
export interface ProductOptionGroup {
  id: string
  name: string
  choices: ProductOptionChoice[]
}

export const PRODUCT_OPTION_GROUP_MAX = 3
export const PRODUCT_OPTION_CHOICE_MAX = 6
export const PRODUCT_OPTION_PRICE_DELTA_MAX = 200_000

export interface ProductExtras {
  /** 정상가. 회차 가격보다 높을 때만 할인율을 보여준다. */
  listPrice?: number
  size?: ProductSize
  light?: LightLevel
  placements?: Placement[]
  petSafe?: boolean
  curations?: Curation[]
  careGuide?: CareGuide
  options?: ProductOptionGroup[]
  /** 품질 보장 대상 */
  guaranteed?: boolean
  /** 검색용 다른 이름(학명·별칭) */
  aliases?: string[]
}

/** 고른 옵션 스냅샷(주문·장바구니) */
export interface SelectedProductOption {
  groupId: string
  groupName: string
  choiceId: string
  choiceLabel: string
  priceDelta: number
}

// ── 판매자 공개 소개 ───────────────────────────────────────────

export interface StoreGuarantee {
  enabled: boolean
  title: string
  terms: string[]
}

export interface StoreProfileExtras {
  /** 한 줄 소개 */
  intro?: string
  /** 재배·매입 환경 소개 */
  story?: string
  /** 지역(예: 경기 이천) */
  region?: string
  /** 운영 시작 연도 */
  sinceYear?: number
  guarantee?: StoreGuarantee
  /** 남은 수량·구매 수를 공개할지(판매자 선택) */
  showDemandSignals?: boolean
}

// ── 후기 ───────────────────────────────────────────────────────

export const REVIEW_TEXT_MAX_LENGTH = 500

export interface ReviewPublic {
  id: string
  productId: string
  rating: number
  text: string
  /** 가린 이름(예: 김*린) */
  authorName: string
  createdAt: string
}

export interface ReviewSummary {
  count: number
  /** 소수 첫째 자리 반올림. 후기가 없으면 0 */
  average: number
}

export interface ProductReviewsResponse {
  summary: ReviewSummary
  items: ReviewPublic[]
}

export interface CreateReviewRequest {
  productId: string
  rating: number
  text: string
}

// ── 쿠폰·스탬프 ───────────────────────────────────────────────

export type CouponDiscountType = 'amount' | 'percent'

export interface CouponSpec {
  name: string
  discountType: CouponDiscountType
  /** amount면 원, percent면 % */
  value: number
  /** percent 쿠폰의 최대 할인(원) */
  maxDiscount?: number | null
  minOrderAmount: number
  endsAt: string | null
}

export interface StoreCoupon extends CouponSpec {
  id: string
  storeId: string
  active: boolean
  claimable: boolean
  startsAt: string | null
  createdAt?: string
  updatedAt?: string
}

export type UserCouponStatus = 'available' | 'used'

export interface UserCoupon extends CouponSpec {
  id: string
  storeId: string
  source: 'claim' | 'stamp'
  status: UserCouponStatus
  usedOrderId: string | null
  claimedAt: string
}

export interface PurchaseStampStage {
  /** 이 단계에 도달하는 배송 완료 주문 수 */
  at: number
  reward: CouponSpec
  /** 받은 쿠폰 id. 아직 안 받았으면 null */
  claimedCouponId: string | null
}

export interface PurchaseStampsResponse {
  count: number
  stages: PurchaseStampStage[]
}

/** 쿠폰 할인액. 최소 주문 금액에 못 미치면 0. 할인액은 주문 금액을 넘지 않는다. */
export function couponDiscountAmount(spec: CouponSpec, orderAmount: number, now = Date.now()): number {
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) return 0
  if (orderAmount < spec.minOrderAmount) return 0
  if (spec.endsAt && Date.parse(spec.endsAt) < now) return 0
  let discount =
    spec.discountType === 'amount'
      ? spec.value
      : Math.floor((orderAmount * spec.value) / 100 / 10) * 10
  if (spec.discountType === 'percent' && spec.maxDiscount) discount = Math.min(discount, spec.maxDiscount)
  return Math.max(0, Math.min(discount, orderAmount))
}

/** 쓸 수 있는 쿠폰 중 할인액이 가장 큰 것. 같으면 먼저 끝나는 쿠폰. */
export function pickBestCoupon<T extends CouponSpec & { status?: UserCouponStatus }>(
  coupons: T[],
  orderAmount: number,
  now = Date.now(),
): { coupon: T; discount: number } | null {
  let best: { coupon: T; discount: number } | null = null
  for (const coupon of coupons) {
    if (coupon.status && coupon.status !== 'available') continue
    const discount = couponDiscountAmount(coupon, orderAmount, now)
    if (discount <= 0) continue
    if (
      !best ||
      discount > best.discount ||
      (discount === best.discount &&
        Date.parse(coupon.endsAt ?? '9999-12-31') < Date.parse(best.coupon.endsAt ?? '9999-12-31'))
    ) {
      best = { coupon, discount }
    }
  }
  return best
}

// ── 선물·요청·문의 ────────────────────────────────────────────

export const GIFT_MESSAGE_MAX_LENGTH = 100

export interface GiftInfo {
  recipientName: string
  senderName: string
  cardMessage: string
}

export const PRODUCT_REQUEST_MAX_LENGTH = 60

export interface ProductRequestItem {
  id: string
  text: string
  createdAt: string
}

export interface PartnerInquiryRequest {
  farmName: string
  region: string
  contact: string
  message: string
  privacyConsent: true
}

export interface PartnerInquiryItem extends Omit<PartnerInquiryRequest, 'privacyConsent'> {
  id: string
  createdAt: string
}

export interface RestockSummaryItem {
  productId: string
  productName: string | null
  count: number
}

// ── 공개 회차 수요 신호 ───────────────────────────────────────

/** showDemandSignals가 켜진 스토어의 공개 회차 상품에만 붙는다. */
export interface RoundItemDemandSignal {
  remainingQuantity: number
}

export interface RoundDemandSignal {
  /** 이번 회차에 주문한 배송지 수 */
  buyerCount: number
}
