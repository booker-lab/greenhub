/** aT 화훼유통정보 부류 코드(flowerGubn). 1 절화, 2 관엽, 3 난, 4 춘란. */
export declare const FLOWER_MARKET_GUBNS: readonly [1, 2, 3, 4];
export type FlowerMarketGubn = (typeof FLOWER_MARKET_GUBNS)[number];
export declare const FLOWER_MARKET_GUBN_LABELS: Record<FlowerMarketGubn, string>;
export declare const MARKET_NAME_MAX_LENGTH = 60;
/** 상품 1개를 만드는 데 드는 경매 단위 수(절화 1속·분화 1분) 상한. */
export declare const MARKET_UNITS_PER_ITEM_MAX = 100;
/** 최근 시세로 보는 기간(일). */
export declare const MARKET_RECENT_DAYS = 28;
/**
 * 상품이 어느 경매 시세를 따르는지. 판매자가 상품마다 정한다.
 * - goodName이 없으면 품목 전체(모든 품종), grade가 없으면 모든 등급을 물량 가중으로 합친다.
 * - unitsPerItem: 상품 1개에 드는 경매 단위 수(예: 꽃다발 1개에 장미 2속 → 2, 호접란 1분 → 1).
 */
export interface ProductMarketRef {
    flowerGubn: FlowerMarketGubn;
    pumName: string;
    goodName?: string;
    grade?: string;
    unitsPerItem: number;
}
/** 하루치 시세(경매 단위 1개 기준, 원). avg는 물량 가중 평균이다. */
export interface MarketPriceStat {
    avg: number;
    min: number;
    max: number;
    qty: number;
}
export interface MarketPriceSummary {
    ref: ProductMarketRef;
    /** 가장 최근 경매일 시세. 연결한 조건의 거래가 없으면 null. */
    latest: (MarketPriceStat & {
        saleDate: string;
    }) | null;
    /** 최근 MARKET_RECENT_DAYS일 시세. 그동안 거래가 없으면 null. */
    recent: (MarketPriceStat & {
        from: string;
        to: string;
        auctionDays: number;
    }) | null;
    /** 상품 1개 기준 예상 매입가(원) = 경매 단가 × unitsPerItem. */
    unitCost: {
        latest: number | null;
        recentAvg: number | null;
    };
    /** 연결한 품목·품종에서 거래된 등급 이름. 등급 고르기에 쓴다. */
    grades: string[];
}
/** 부류별로 지금까지 수집된 품목·품종 이름. 연결 칸 고르기에 쓴다. */
export interface MarketCatalog {
    flowerGubn: FlowerMarketGubn;
    items: Array<{
        pumName: string;
        goodNames: string[];
    }>;
    updatedAt: string | null;
}
//# sourceMappingURL=market-price.types.d.ts.map