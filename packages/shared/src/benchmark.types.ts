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
  /** 고객이 문구를 직접 써야 하는 선택지(예: 스티커 라벨·3D 토퍼) */
  needsText?: boolean
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
/** 라벨·토퍼에 넣는 문구 최대 길이(글자) */
export const OPTION_TEXT_MAX_LENGTH = 20

export interface ProductExtras {
  size?: ProductSize
  light?: LightLevel
  placements?: Placement[]
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
  /** 문구가 필요한 선택지에 고객이 쓴 문구 */
  text?: string
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

// ── 선물·요청·문의 ────────────────────────────────────────────

export const GIFT_MESSAGE_MAX_LENGTH = 100

export interface GiftInfo {
  recipientName: string
  /** 받는 분 휴대폰(배송 연락용) */
  recipientPhone: string
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
