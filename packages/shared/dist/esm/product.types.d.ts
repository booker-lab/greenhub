export type Category = 'cut_flower' | 'orchid' | 'foliage';
export type ColorOption = '레드' | '핑크' | '연핑크' | '로즈' | '화이트' | '크림' | '옐로우' | '골드' | '오렌지' | '퍼플' | '바이올렛' | '연보라' | '블루' | '그린' | '무늬' | '브라운' | '베이지' | '블랙' | '그레이';
export type DeliverySize = 'small' | 'medium' | 'large';
export type FragranceLevel = 'none' | 'light' | 'strong';
export type BloomCondition = 'bud' | 'half' | 'full';
export type StemType = '외대' | '쌍대' | '가지' | '3대';
export interface Selection {
    colors: ColorOption[];
    stemType: StemType;
    fragrance: FragranceLevel;
    bloomCondition: BloomCondition;
    bundleUnit: string;
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
    minParticipants: number;
    maxParticipants: number;
    recruitDeadline: string;
    currentParticipants: number;
    groupDeliveryDate: string;
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
    createdAt: string;
    updatedAt: string;
    groupSummary?: {
        currentParticipants: number;
        minParticipants: number;
        maxParticipants: number;
        recruitDeadline: string;
    };
    varietyId?: string;
    selection?: Selection;
    sellerNote?: string;
    content?: GeneratedContent;
    sellerOverride?: boolean;
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
        currentParticipants: number;
        minParticipants: number;
        maxParticipants: number;
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