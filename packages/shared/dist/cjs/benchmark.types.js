"use strict";
// 팔도감 벤치마킹 비교용 기능의 공개 계약. 모든 필드는 선택이라 기존 데이터·응답과 호환된다.
// 기능 토글은 features.ts를 따른다.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT_REQUEST_MAX_LENGTH = exports.GIFT_MESSAGE_MAX_LENGTH = exports.REVIEW_HIDE_REASON_LABELS = exports.REVIEW_HIDE_REASONS = exports.REVIEW_HIDE_REASON_MAX_LENGTH = exports.REVIEW_PHOTO_CONTENT_TYPES = exports.REVIEW_PHOTO_MAX_BYTES = exports.REVIEW_PHOTO_MAX_COUNT = exports.REVIEW_TEXT_MAX_LENGTH = exports.PRODUCT_NOTICE_DEFAULT_CERTIFICATION = exports.PRODUCT_NOTICE_DEFAULT_ORIGIN = exports.PRODUCT_NOTICE_FIELDS = exports.OPTION_TEXT_MAX_LENGTH = exports.PRODUCT_OPTION_PRICE_DELTA_MAX = exports.PRODUCT_OPTION_CHOICE_MAX = exports.PRODUCT_OPTION_GROUP_MAX = exports.PLACEMENT_LABELS = exports.PLACEMENTS = exports.LIGHT_LABELS = exports.LIGHT_LEVELS = void 0;
exports.resolveProductNotice = resolveProductNotice;
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
/** 고시 항목의 표시 순서·이름·최대 길이(글자). API 검증과 판매자 입력이 같이 쓴다. */
exports.PRODUCT_NOTICE_FIELDS = [
    { key: 'itemName', label: '품명', maxLength: 60 },
    { key: 'origin', label: '원산지', maxLength: 40 },
    { key: 'producer', label: '생산자', maxLength: 40 },
    { key: 'certification', label: '인증·허가 사항', maxLength: 100 },
    { key: 'csPhone', label: '소비자 상담 전화', maxLength: 20 },
];
exports.PRODUCT_NOTICE_DEFAULT_ORIGIN = '국내산(경기도 이천)';
exports.PRODUCT_NOTICE_DEFAULT_CERTIFICATION = '해당 없음';
/** 빈 칸(공백만 있는 칸 포함)을 기본값으로 채운 표시용 고시 값 */
function resolveProductNotice(notice, fallback) {
    const pick = (value, alt) => value?.trim() || alt;
    return {
        itemName: pick(notice?.itemName, fallback.itemName),
        origin: pick(notice?.origin, exports.PRODUCT_NOTICE_DEFAULT_ORIGIN),
        producer: pick(notice?.producer, fallback.producer),
        certification: pick(notice?.certification, exports.PRODUCT_NOTICE_DEFAULT_CERTIFICATION),
        csPhone: pick(notice?.csPhone, fallback.csPhone),
    };
}
// ── 후기 ───────────────────────────────────────────────────────
exports.REVIEW_TEXT_MAX_LENGTH = 500;
/** 후기 하나에 붙일 수 있는 사진 수 */
exports.REVIEW_PHOTO_MAX_COUNT = 3;
/** 후기 사진 한 장의 최대 크기(바이트). 앱은 JPEG로 줄여 올린다. */
exports.REVIEW_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** 서버가 받는 후기 사진 형식. 위치 정보 등 메타데이터를 지울 수 있는 JPEG만 받는다. */
exports.REVIEW_PHOTO_CONTENT_TYPES = ['image/jpeg'];
/** 숨길 때 덧붙이는 설명(선택)의 최대 길이 */
exports.REVIEW_HIDE_REASON_MAX_LENGTH = 200;
/**
 * 후기를 숨길 수 있는 사유. 이 목록에서만 고른다.
 * 불만이나 낮은 별점은 숨김 사유가 아니다.
 */
exports.REVIEW_HIDE_REASONS = ['spam', 'abuse', 'privacy', 'off-topic'];
exports.REVIEW_HIDE_REASON_LABELS = {
    spam: '광고·스팸',
    abuse: '욕설·비방',
    privacy: '개인정보 노출',
    'off-topic': '상품과 무관',
};
// ── 선물·요청·문의 ────────────────────────────────────────────
exports.GIFT_MESSAGE_MAX_LENGTH = 100;
exports.PRODUCT_REQUEST_MAX_LENGTH = 60;
