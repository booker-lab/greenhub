"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NON_REDELIVERABLE_HOLD_REASONS = exports.ORDER_REQUEST_NOTE_MAX_LENGTH = void 0;
exports.isNonRedeliverableHoldReason = isNonRedeliverableHoldReason;
/** 주문 요청사항(받는 분·토퍼 문구·배송 요청 등 자유 입력) 최대 글자 수 */
exports.ORDER_REQUEST_NOTE_MAX_LENGTH = 200;
/**
 * 재배송하지 않는 보류 사유. 이 보류는 주문 취소(전액 환불)로만 끝나고 재배송 준비·배송 재개로
 * 돌아가지 않는다(apps/api/src/orders/orders.helpers.ts deliveryTransitionViolation).
 */
exports.NON_REDELIVERABLE_HOLD_REASONS = [
    'PRODUCT_DAMAGED',
];
/** 재배송하지 않는(취소로만 끝나는) 보류 사유인지 확인한다. 알 수 없는 값은 false다. */
function isNonRedeliverableHoldReason(reasonCode) {
    return (typeof reasonCode === 'string' &&
        exports.NON_REDELIVERABLE_HOLD_REASONS.includes(reasonCode));
}
