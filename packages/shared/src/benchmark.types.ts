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

/** 후기 하나에 붙일 수 있는 사진 수 */
export const REVIEW_PHOTO_MAX_COUNT = 3
/** 후기 사진 한 장의 최대 크기(바이트). 앱은 JPEG로 줄여 올린다. */
export const REVIEW_PHOTO_MAX_BYTES = 5 * 1024 * 1024
/** 서버가 받는 후기 사진 형식. 위치 정보 등 메타데이터를 지울 수 있는 JPEG만 받는다. */
export const REVIEW_PHOTO_CONTENT_TYPES = ['image/jpeg'] as const
/** 숨길 때 덧붙이는 설명(선택)의 최대 길이 */
export const REVIEW_HIDE_REASON_MAX_LENGTH = 200

/**
 * 후기를 숨길 수 있는 사유. 이 목록에서만 고른다.
 * 불만이나 낮은 별점은 숨김 사유가 아니다.
 */
export const REVIEW_HIDE_REASONS = ['spam', 'abuse', 'privacy', 'off-topic'] as const
export type ReviewHideReason = (typeof REVIEW_HIDE_REASONS)[number]
export const REVIEW_HIDE_REASON_LABELS: Record<ReviewHideReason, string> = {
  spam: '광고·스팸',
  abuse: '욕설·비방',
  privacy: '개인정보 노출',
  'off-topic': '상품과 무관',
}

export interface ReviewPublic {
  id: string
  productId: string
  rating: number
  text: string
  /** 가린 이름(예: 김*린) */
  authorName: string
  createdAt: string
  /** 사진 읽기용 짧은 기간 서명 URL. 사진이 없으면 빈 배열이거나 없다. */
  photoUrls?: string[]
}

/** 후기를 숨기거나 숨김 해제한 사람의 역할 */
export type ReviewModeratorRole = 'seller' | 'admin'

/** 쓴 사람이 자기 주문에서 보는 후기 */
export interface OwnReview extends ReviewPublic {
  /** 판매자·관리자가 숨긴 후기면 true(공개 목록·별점에서 빠진다) */
  hidden: boolean
  /** 숨긴 사유 분류. 숨긴 사람이 쓴 설명은 보내지 않는다. */
  hiddenReasonCode?: ReviewHideReason
}

/** 판매자·관리자가 보는 후기(숨김 상태 포함) */
export interface ManagedReview extends ReviewPublic {
  hidden: boolean
  /** 숨긴 사유 분류·설명·시각·역할. 숨김을 해제하면 비운다(기록은 서버 이력에 남는다). */
  hiddenReasonCode?: ReviewHideReason
  hiddenNote?: string
  hiddenAt?: string
  hiddenByRole?: ReviewModeratorRole
}

/** 관리자 콘솔 숨긴 후기 목록 한 줄 */
export interface AdminHiddenReview extends ManagedReview {
  storeId: string
  storeName: string | null
  productName: string | null
}

export interface HideReviewRequest {
  reasonCode: ReviewHideReason
  /** 선택 설명(관리자·판매자만 본다) */
  note?: string
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
