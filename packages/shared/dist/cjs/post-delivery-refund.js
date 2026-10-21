"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST_DELIVERY_REFUND_MEMO_MAX_LENGTH = exports.POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS = exports.POST_DELIVERY_REFUNDABLE_STATUSES = exports.POST_DELIVERY_REFUND_REASON_LABEL = exports.POST_DELIVERY_REFUND_REASON_CODES = void 0;
exports.isWithinSellerRefundWindow = isWithinSellerRefundWindow;
/** 사유 4종 배열 — DTO 검증(@IsIn)과 화면 선택지 순서에 재사용 */
exports.POST_DELIVERY_REFUND_REASON_CODES = [
    'QUALITY_DAMAGED',
    'BROKEN',
    'WRONG_DELIVERY',
    'OTHER',
];
exports.POST_DELIVERY_REFUND_REASON_LABEL = {
    QUALITY_DAMAGED: '꽃 상함',
    BROKEN: '파손',
    WRONG_DELIVERY: '잘못 배송',
    OTHER: '기타',
};
/** 배송 후 환불을 시작할 수 있는 주문 상태(배송 완료로 표시된 주문) */
exports.POST_DELIVERY_REFUNDABLE_STATUSES = [
    'DELIVERED',
    'PICKED_UP',
    'REVIEWED',
];
/** 판매자가 직접 환불할 수 있는 기간(일). 기준 시각은 정산 settledAt(배송 완료 시각)이다. */
exports.POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS = 7;
/** 환불 메모 최대 글자 수 */
exports.POST_DELIVERY_REFUND_MEMO_MAX_LENGTH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * 판매자 직접 환불 기간 안인지 판정한다. settledAt이 없거나 미래·잘못된 값이면 false(fail closed).
 * 경계: 정확히 7일이 지난 순간부터 기간 밖이다(정산 확정 배치의 `settledAt < 지금 - 7일`과 같은 경계).
 */
function isWithinSellerRefundWindow(settledAtMs, nowMs) {
    if (typeof settledAtMs !== 'number' || !Number.isFinite(settledAtMs))
        return false;
    if (settledAtMs > nowMs)
        return false;
    return nowMs - settledAtMs < exports.POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS * DAY_MS;
}
