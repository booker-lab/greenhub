// 화훼 경매 시세(aT 화훼공판장 경락가격) 공개 계약. 판매자 화면만 쓴다(손님 응답에는 넣지 않는다).
/** aT 화훼유통정보 부류 코드(flowerGubn). 1 절화, 2 관엽, 3 난, 4 춘란. */
export const FLOWER_MARKET_GUBNS = [1, 2, 3, 4];
export const FLOWER_MARKET_GUBN_LABELS = {
    1: '절화',
    2: '관엽',
    3: '난',
    4: '춘란',
};
export const MARKET_NAME_MAX_LENGTH = 60;
/** 상품 1개를 만드는 데 드는 경매 단위 수(절화 1속·분화 1분) 상한. */
export const MARKET_UNITS_PER_ITEM_MAX = 100;
/** 최근 시세로 보는 기간(일). */
export const MARKET_RECENT_DAYS = 28;
//# sourceMappingURL=market-price.types.js.map