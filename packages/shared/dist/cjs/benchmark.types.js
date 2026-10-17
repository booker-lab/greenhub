"use strict";
// 팔도감 벤치마킹 비교용 기능의 공개 계약. 모든 필드는 선택이라 기존 데이터·응답과 호환된다.
// 기능 토글은 features.ts를 따른다.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT_REQUEST_MAX_LENGTH = exports.GIFT_MESSAGE_MAX_LENGTH = exports.REVIEW_TEXT_MAX_LENGTH = exports.OPTION_TEXT_MAX_LENGTH = exports.PRODUCT_OPTION_PRICE_DELTA_MAX = exports.PRODUCT_OPTION_CHOICE_MAX = exports.PRODUCT_OPTION_GROUP_MAX = exports.PLACEMENT_LABELS = exports.PLACEMENTS = exports.LIGHT_LABELS = exports.LIGHT_LEVELS = void 0;
exports.LIGHT_LEVELS = ['bright', 'medium', 'low'];
exports.LIGHT_LABELS = {
    bright: '밝은 곳',
    medium: '반그늘',
    low: '그늘에서도',
};
exports.PLACEMENTS = ['living', 'office', 'bedroom', 'store'];
exports.PLACEMENT_LABELS = {
    living: '거실',
    office: '사무실',
    bedroom: '침실',
    store: '매장·개업',
};
exports.PRODUCT_OPTION_GROUP_MAX = 3;
exports.PRODUCT_OPTION_CHOICE_MAX = 6;
exports.PRODUCT_OPTION_PRICE_DELTA_MAX = 200_000;
/** 라벨·토퍼에 넣는 문구 최대 길이(글자) */
exports.OPTION_TEXT_MAX_LENGTH = 20;
// ── 후기 ───────────────────────────────────────────────────────
exports.REVIEW_TEXT_MAX_LENGTH = 500;
// ── 선물·요청·문의 ────────────────────────────────────────────
exports.GIFT_MESSAGE_MAX_LENGTH = 100;
exports.PRODUCT_REQUEST_MAX_LENGTH = 60;
