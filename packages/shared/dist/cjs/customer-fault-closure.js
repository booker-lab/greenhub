"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDELIVERY_FEE_PAYMENT_DAYS = exports.CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH = void 0;
exports.isCustomerFaultClosableHoldReason = isCustomerFaultClosableHoldReason;
exports.customerFaultClosureReasonFor = customerFaultClosureReasonFor;
exports.redeliveryPaymentRequestedAtOf = redeliveryPaymentRequestedAtOf;
exports.redeliveryFeePaymentDeadlineDateKST = redeliveryFeePaymentDeadlineDateKST;
exports.customerFaultClosureEligibleAtMs = customerFaultClosureEligibleAtMs;
exports.formatKoreanMonthDayKST = formatKoreanMonthDayKST;
/** 판매자가 손님과 연락한 내용을 남기는 메모의 최대 글자 수. 손님에게는 보내지 않는다. */
exports.CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH = 200;
/** 재배송비를 결제할 수 있는 날 수. 결제 요청을 보낸 날은 세지 않는다(요청일 + 3일째 되는 날 끝까지). */
exports.REDELIVERY_FEE_PAYMENT_DAYS = 3;
/** 종결할 수 없는 보류 사유: 기상(고객 책임 아님)·상품 파손(판매자·기사 책임, 취소·환불로만 끝남). */
const NON_CLOSABLE_HOLD_REASONS = ['WEATHER', 'PRODUCT_DAMAGED'];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 고객 사유 종결을 검토할 수 있는 보류 사유인지. 알 수 없는 값은 false다. */
function isCustomerFaultClosableHoldReason(reasonCode) {
    return (typeof reasonCode === 'string' &&
        reasonCode.length > 0 &&
        !NON_CLOSABLE_HOLD_REASONS.includes(reasonCode));
}
/** 보류 사유로 정한 종결 사유. 수령 거부만 따로 두고 나머지는 재배송비 미결제다. */
function customerFaultClosureReasonFor(holdReasonCode) {
    return holdReasonCode === 'RECEIPT_REFUSED' ? 'RECEIPT_REFUSED' : 'REDELIVERY_FEE_UNPAID';
}
function parseMillis(value) {
    if (typeof value !== 'string' || value.trim().length === 0)
        return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}
/** 주어진 시각이 속한 서울 날짜의 00:00(UTC 기준 ms). */
function seoulMidnightOf(atMs) {
    const shifted = atMs + KST_OFFSET_MS;
    return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - KST_OFFSET_MS;
}
/**
 * 현재 보류의 재배송비 결제 요청 시각(deliveryHold.paymentRequestedAt, ISO8601). 요청 전(칸 없음·null)이거나
 * 읽을 수 없는 값이면 null이다. 서버는 유료 고객 책임 보류를 '재배송 준비로 돌리기'(DELIVERY_HELD → PREPARING)할
 * 때 같은 트랜잭션에서 처음 한 번만 적는다.
 */
function redeliveryPaymentRequestedAtOf(hold) {
    if (typeof hold !== 'object' || hold === null)
        return null;
    const value = hold['paymentRequestedAt'];
    return typeof value === 'string' && parseMillis(value) !== null ? value : null;
}
/**
 * 재배송비 결제 마지막 날(서울 날짜 YYYY-MM-DD). 결제 요청을 보낸 날은 세지 않으므로 요청일 + 3일이다.
 * 이 날 끝(23:59:59)까지 결제할 수 있다. 요청 시각이 없거나 잘못되면 null(fail closed).
 */
function redeliveryFeePaymentDeadlineDateKST(paymentRequestedAt) {
    const requestedAtMs = parseMillis(paymentRequestedAt);
    if (requestedAtMs === null)
        return null;
    const deadlineStart = seoulMidnightOf(requestedAtMs) + exports.REDELIVERY_FEE_PAYMENT_DAYS * DAY_MS;
    return new Date(deadlineStart + KST_OFFSET_MS).toISOString().slice(0, 10);
}
/**
 * 재배송비 미결제로 종결할 수 있게 되는 시각(UTC ms): 결제 요청일 + 4일의 서울 00:00.
 * 요청 시각이 없거나 잘못되면 null(fail closed — 종결할 수 없다).
 */
function customerFaultClosureEligibleAtMs(paymentRequestedAt) {
    const requestedAtMs = parseMillis(paymentRequestedAt);
    if (requestedAtMs === null)
        return null;
    return seoulMidnightOf(requestedAtMs) + (exports.REDELIVERY_FEE_PAYMENT_DAYS + 1) * DAY_MS;
}
/** 서울 날짜 YYYY-MM-DD 또는 시각(ms)을 "11월 17일"처럼 쓴다. 잘못된 값이면 null. */
function formatKoreanMonthDayKST(value) {
    if (value === null || value === undefined)
        return null;
    let dateStr;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            return null;
        dateStr = new Date(value + KST_OFFSET_MS).toISOString().slice(0, 10);
    }
    else {
        dateStr = value;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match)
        return null;
    return `${Number(match[2])}월 ${Number(match[3])}일`;
}
