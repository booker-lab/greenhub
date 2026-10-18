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
/** 후기 하나에 붙일 수 있는 사진 수 */
export const REVIEW_PHOTO_MAX_COUNT = 3;
/** 후기 사진 한 장의 최대 크기(바이트). 앱은 JPEG로 줄여 올린다. */
export const REVIEW_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** 서버가 받는 후기 사진 형식. 위치 정보 등 메타데이터를 지울 수 있는 JPEG만 받는다. */
export const REVIEW_PHOTO_CONTENT_TYPES = ['image/jpeg'];
/** 숨길 때 덧붙이는 설명(선택)의 최대 길이 */
export const REVIEW_HIDE_REASON_MAX_LENGTH = 200;
/**
 * 후기를 숨길 수 있는 사유. 이 목록에서만 고른다.
 * 불만이나 낮은 별점은 숨김 사유가 아니다.
 */
export const REVIEW_HIDE_REASONS = ['spam', 'abuse', 'privacy', 'off-topic'];
export const REVIEW_HIDE_REASON_LABELS = {
    spam: '광고·스팸',
    abuse: '욕설·비방',
    privacy: '개인정보 노출',
    'off-topic': '상품과 무관',
};
// ── 선물·요청·문의 ────────────────────────────────────────────
export const GIFT_MESSAGE_MAX_LENGTH = 100;
export const PRODUCT_REQUEST_MAX_LENGTH = 60;
//# sourceMappingURL=benchmark.types.js.map