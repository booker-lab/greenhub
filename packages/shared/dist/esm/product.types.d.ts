export type Category = 'cut_flower' | 'orchid' | 'foliage';
export declare const COLOR_OPTIONS: readonly ["레드", "핑크", "연핑크", "로즈", "화이트", "크림", "옐로우", "골드", "오렌지", "퍼플", "바이올렛", "연보라", "블루", "그린", "무늬", "브라운", "베이지", "블랙", "그레이"];
export type ColorOption = (typeof COLOR_OPTIONS)[number];
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
import type { SaleType, DeliveryMethod } from './order.types.js';
export type { SaleType, DeliveryMethod };
export interface GroupProductConfig {
    productId: string;
    minQuantity: number;
    targetQuantity: number;
    maxPerPerson: number;
    recruitDeadline: string;
    currentQuantity: number;
    groupDeliveryDate: string;
    groupDeliveryMethod: 'direct' | 'parcel';
    deliveryFeeDiscount: number;
}
/** Public group config — explicit allowlist (drops isProcessed and internals). */
export interface GroupConfigPublic {
    productId: string;
    minQuantity: number;
    targetQuantity: number;
    maxPerPerson: number;
    recruitDeadline: string | null;
    currentQuantity: number;
    groupDeliveryDate: string | null;
    groupDeliveryMethod: 'direct' | 'parcel';
    deliveryFeeDiscount: number;
}
/** Public group summary for list responses — minimal allowlist. */
export interface GroupSummaryPublic {
    currentQuantity: number;
    minQuantity: number;
    targetQuantity: number;
    recruitDeadline: string | null;
}
/** Public product detail — explicit allowlist (drops sellerNote/sellerOverride/content.isEditedByUser/testOnly/raw internals). */
export interface ProductPublic extends ProductExtras {
    id: string;
    storeId: string;
    name: string;
    images: string[];
    price: number;
    category: Category;
    saleType: SaleType;
    deliverySize: DeliverySize;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    varietyId?: string;
    selection?: Selection;
    content?: {
        headline: string;
        description: string;
    };
    description?: string;
    colors?: ColorOption[];
    groupConfig?: GroupConfigPublic;
}
import type { ProductExtras } from './benchmark.types.js';
import type { ProductMarketRef } from './market-price.types.js';
export interface Product extends ProductExtras {
    id: string;
    storeId: string;
    name: string;
    images: string[];
    price: number;
    category: Category;
    saleType: SaleType;
    deliverySize: DeliverySize;
    isActive: boolean;
    testOnly?: boolean;
    createdAt: string;
    updatedAt: string;
    groupSummary?: {
        currentQuantity: number;
        minQuantity: number;
        targetQuantity: number;
        recruitDeadline: string;
    };
    varietyId?: string;
    selection?: Selection;
    sellerNote?: string;
    content?: GeneratedContent;
    sellerOverride?: boolean;
    /** 따라 볼 경매 시세(판매자 전용, 공개 응답 allowlist에 없다). null이면 연결을 지운 것이다. */
    marketRef?: ProductMarketRef | null;
    description?: string;
    colors?: ColorOption[];
}
export interface ProductSummary {
    id: string;
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
        recruitDeadline: string;
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
    updatedAt: string;
}
//# sourceMappingURL=product.types.d.ts.map