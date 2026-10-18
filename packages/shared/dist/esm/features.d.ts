export declare const FEATURE_KEYS: readonly ["payment-fail-stay", "open-alert", "hide-empty-past", "countdown-date", "detail-images", "arrival-everywhere", "category-round-label", "guest-cart", "icheon-precheck", "order-success-guide", "reorder", "purchase-history", "option-sheet", "seller-store", "quality-guarantee", "reviews", "card-discount", "size-info", "wishlist", "restock-alert", "gift", "cart-upsell", "product-request", "demand-signals", "plant-search", "care-guide", "recommendations", "partner-inquiry"];
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureGroup = 'ux' | 'matrix' | 'gap';
export interface FeatureInfo {
    key: FeatureKey;
    group: FeatureGroup;
    title: string;
    /** 기능을 켰을 때 달라지는 것 한 줄 */
    summary: string;
}
export declare const FEATURES: readonly FeatureInfo[];
export declare function parseFeatureFlags(value: string | null | undefined): ReadonlySet<FeatureKey>;
//# sourceMappingURL=features.d.ts.map