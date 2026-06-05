export type Category = 'cut_flower' | 'orchid' | 'foliage';

export type ColorOption =
  | '레드'
  | '핑크'
  | '연핑크'
  | '로즈'
  | '화이트'
  | '크림'
  | '옐로우'
  | '골드'
  | '오렌지'
  | '퍼플'
  | '바이올렛'
  | '연보라'
  | '블루'
  | '그린'
  | '무늬'
  | '브라운'
  | '베이지'
  | '블랙'
  | '그레이';

export type DeliverySize = 'small' | 'medium' | 'large';

export type FragranceLevel = 'none' | 'light' | 'strong';
export type BloomCondition = 'bud' | 'half' | 'full';
export type StemType = '외대' | '쌍대' | '가지' | '3대';
export type CareLevel = 'easy' | 'normal' | 'hard';

export interface Selection {
  colors: ColorOption[];
  stemType: StemType;
  fragrance: FragranceLevel;
  bloomCondition: BloomCondition;
  bundleUnit: string;
  careLevel?: CareLevel;
}

export interface GeneratedContent {
  headline: string;
  description: string;
  isEditedByUser: boolean;
}

// SaleType, DeliveryMethod are defined in order.types.ts — imported for local use and re-exported
import type { DeliveryMethod, SaleType } from './order.types.js';

export type { DeliveryMethod, SaleType };

export interface GroupProductConfig {
  productId: string;
  minQuantity: number; // 최소 수량 (미달 시 자동 취소)
  targetQuantity: number; // 목표 수량 (선착순 확정 기준)
  maxPerPerson: number; // 1인 최대 구매 수량
  recruitDeadline: string; // ISO8601
  currentQuantity: number; // Firestore 실시간 누적 수량
  groupDeliveryDate: string; // ISO8601
  groupDeliveryMethod: 'direct' | 'parcel';
  deliveryFeeDiscount: number;
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  images: string[];
  price: number;
  category: Category;
  saleType: SaleType;
  deliverySize: DeliverySize;
  isActive: boolean;
  createdAt: string; // ISO8601
  updatedAt: string; // ISO8601
  groupSummary?: {
    currentQuantity: number;
    minQuantity: number;
    targetQuantity: number;
    recruitDeadline: string; // ISO8601
  };
  // AI 시스템 신규 필드
  varietyId?: string;
  selection?: Selection;
  sellerNote?: string;
  content?: GeneratedContent;
  sellerOverride?: boolean;
  // 마이그레이션 호환 — 신규 등록 시 미사용
  description?: string;
  colors?: ColorOption[];
}

export interface ProductSummary {
  id: string;
  storeId?: string;
  name: string;
  price: number;
  images: string[];
  category: Category;
  colors?: ColorOption[];
  saleType: SaleType;
  isActive: boolean;
  groupSummary?: {
    currentQuantity: number;
    minQuantity: number;
    targetQuantity: number;
    recruitDeadline: string; // ISO8601
  };
}

export interface DeliveryFeeConfig {
  storeId: string;
  directFee: number;
  hubFee: number;
  parcelFee: number;
  freeThresholdDirect: number;
  freeThresholdHub: number;
  freeThresholdParcel: number;
  weatherRestrictionActive: boolean;
  updatedAt: string; // ISO8601
}
