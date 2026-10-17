// 팔도감 벤치마킹 비교용 기능의 공개 계약. 모든 필드는 선택이라 기존 데이터·응답과 호환된다.
// 기능 토글은 features.ts를 따른다.
export const LIGHT_LEVELS = ['bright', 'medium', 'low'];
export const LIGHT_LABELS = {
    bright: '밝은 곳',
    medium: '반그늘',
    low: '그늘에서도',
};
export const PLACEMENTS = ['living', 'office', 'bedroom', 'store'];
export const PLACEMENT_LABELS = {
    living: '거실',
    office: '사무실',
    bedroom: '침실',
    store: '매장·개업',
};
export const PRODUCT_OPTION_GROUP_MAX = 3;
export const PRODUCT_OPTION_CHOICE_MAX = 6;
export const PRODUCT_OPTION_PRICE_DELTA_MAX = 200_000;
/** 라벨·토퍼에 넣는 문구 최대 길이(글자) */
export const OPTION_TEXT_MAX_LENGTH = 20;
// ── 후기 ───────────────────────────────────────────────────────
export const REVIEW_TEXT_MAX_LENGTH = 500;
// ── 선물·요청·문의 ────────────────────────────────────────────
export const GIFT_MESSAGE_MAX_LENGTH = 100;
export const PRODUCT_REQUEST_MAX_LENGTH = 60;
//# sourceMappingURL=benchmark.types.js.map