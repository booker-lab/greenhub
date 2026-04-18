export type Category = 'cut_flower' | 'orchid' | 'foliage'

export type ColorOption =
  | '레드'
  | '핑크'
  | '화이트'
  | '옐로우'
  | '오렌지'
  | '퍼플'
  | '블루'
  | '그린'
  | '무늬'
  | '브라운'
  | '베이지'
  | '블랙'
  | '그레이'

export type DeliverySize = 'small' | 'medium' | 'large'

export type FragranceLevel = 'none' | 'light' | 'strong'
export type BloomCondition = 'bud' | 'half' | 'full'

export interface Selection {
  colors: ColorOption[]
  fragrance: FragranceLevel
  bloomCondition: BloomCondition
  bundleUnit: string
}

export interface GeneratedContent {
  headline: string
  description: string
  isEditedByUser: boolean
}

// SaleType, DeliveryMethod are defined in order.types.ts — imported for local use and re-exported
import type { SaleType, DeliveryMethod } from './order.types.js'
export type { SaleType, DeliveryMethod }

export interface GroupProductConfig {
  productId: string
  minParticipants: number
  maxParticipants: number
  recruitDeadline: string // ISO8601
  currentParticipants: number
  groupDeliveryDate: string // ISO8601
  groupDeliveryMethod: 'direct' | 'parcel'
  deliveryFeeDiscount: number
}

export interface Product {
  id: string
  storeId: string
  name: string
  images: string[]
  price: number
  category: Category
  saleType: SaleType
  deliverySize: DeliverySize
  isActive: boolean
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
  groupSummary?: {
    currentParticipants: number
    minParticipants: number
    maxParticipants: number
    recruitDeadline: string // ISO8601
  }
  // AI 시스템 신규 필드
  varietyId?: string
  selection?: Selection
  sellerNote?: string
  content?: GeneratedContent
  sellerOverride?: boolean
  // 마이그레이션 호환 — 신규 등록 시 미사용
  description?: string
  colors?: ColorOption[]
}

export interface ProductSummary {
  id: string
  name: string
  price: number
  images: string[]
  category: Category
  colors?: ColorOption[]
  saleType: SaleType
  isActive: boolean
  groupSummary?: {
    currentParticipants: number
    minParticipants: number
    maxParticipants: number
    recruitDeadline: string // ISO8601
  }
}

export interface DeliveryFeeConfig {
  storeId: string
  directFee: number
  hubFee: number
  parcelFee: number
  freeThresholdDirect: number
  freeThresholdHub: number
  freeThresholdParcel: number
  weatherRestrictionActive: boolean
  updatedAt: string // ISO8601
}
