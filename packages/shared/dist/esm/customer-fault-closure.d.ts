/** 종결 사유. 수령 거부는 바로, 그 밖의 고객 책임 보류는 재배송비 결제 기한이 지나야 종결할 수 있다. */
export type CustomerFaultClosureReasonCode = 'RECEIPT_REFUSED' | 'REDELIVERY_FEE_UNPAID';
export type CustomerFaultClosureActorRole = 'seller' | 'admin';
/** 판매자가 손님과 연락한 내용을 남기는 메모의 최대 글자 수. 손님에게는 보내지 않는다. */
export declare const CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH = 200;
/** 재배송비를 결제할 수 있는 날 수. 결제 요청을 보낸 날은 세지 않는다(요청일 + 3일째 되는 날 끝까지). */
export declare const REDELIVERY_FEE_PAYMENT_DAYS = 3;
/** 주문 문서의 customerFaultClosure 칸. 종결한 주문에만 있다. */
export interface CustomerFaultClosureRecord {
    reasonCode: CustomerFaultClosureReasonCode;
    /** 종결한 보류의 heldAt(ISO8601) */
    heldAt: string;
    /** 그 보류의 재배송비(원). 결제되지 않았으므로 받은 돈이 아니다. */
    redeliveryFee: number | null;
    actorRole: CustomerFaultClosureActorRole;
    actorId: string;
    /** 판매자가 손님과 연락한 기록(내부용) */
    memo: string;
    closedAt: string;
}
/**
 * 종결할 수 있는지 판정한 결과 이유. 서버(GET 판정·POST 종결)와 판매자 화면이 같은 값을 쓴다.
 * - PAYMENT_NOT_REQUESTED: 손님에게 재배송비 결제 요청을 아직 보내지 않았다(판매자가 '재배송 준비로 돌리기'를
 *   눌러야 요청이 가고 기한이 시작된다). 수령 거부는 해당하지 않는다.
 * - PAYMENT_WINDOW_OPEN: 재배송비 결제 기한이 아직 남았다(eligibleAt부터 종결할 수 있다).
 * - REDELIVERY_PAYMENT_IN_PROGRESS: 결제를 시작한 지 24시간이 안 된 재배송비가 있다.
 * - REDELIVERY_PAYMENT_NEEDS_REVIEW: 재배송비 결제 연결이 어긋났거나 환불·불일치 상태라 운영 확인이 필요하다.
 * - INVALID_HOLD: 보류 기록(보류 시각·재배송비)을 확인할 수 없다.
 */
export type CustomerFaultClosureBlockReason = 'OK' | 'ALREADY_CLOSED' | 'NOT_ROUND_ORDER' | 'NOT_DIRECT_DELIVERY' | 'NOT_HELD' | 'HOLD_REASON_NOT_ELIGIBLE' | 'NOT_CUSTOMER_RESPONSIBLE' | 'INVALID_HOLD' | 'CANCELLATION_IN_PROGRESS' | 'REDELIVERY_FEE_PAID' | 'REDELIVERY_PAYMENT_NEEDS_REVIEW' | 'PAYMENT_NOT_REQUESTED' | 'PAYMENT_WINDOW_OPEN' | 'REDELIVERY_PAYMENT_IN_PROGRESS';
/** GET stores/:storeId/orders/:orderId/customer-fault-closure 응답 */
export interface CustomerFaultClosureEligibility {
    eligible: boolean;
    reason: CustomerFaultClosureBlockReason;
    /** 종결하면 남길 사유. 고객 책임 보류가 아니면 null */
    closureReasonCode: CustomerFaultClosureReasonCode | null;
    /**
     * 재배송비 미결제로 종결할 수 있게 되는 시각(ISO8601). 수령 거부는 보류 시각과 같다.
     * 그 밖의 사유는 결제 요청 전이면 null이다.
     */
    eligibleAt: string | null;
    /** 재배송비 결제 마지막 날(서울 YYYY-MM-DD). 결제 요청 전이면 null이다. */
    paymentDeadlineDate: string | null;
    redeliveryFee: number | null;
    /**
     * 이미 종결한 주문(ALREADY_CLOSED)인데 정산이 없으면 true. 종결 뒤 정산 생성이 실패한 경우라
     * 같은 종결 요청(POST)을 다시 보내 정산만 맞춘다. 그 밖의 판정에서는 없거나 false다.
     */
    settlementMissing?: boolean;
}
/** 고객 사유 종결을 검토할 수 있는 보류 사유인지. 알 수 없는 값은 false다. */
export declare function isCustomerFaultClosableHoldReason(reasonCode: unknown): boolean;
/** 보류 사유로 정한 종결 사유. 수령 거부만 따로 두고 나머지는 재배송비 미결제다. */
export declare function customerFaultClosureReasonFor(holdReasonCode: unknown): CustomerFaultClosureReasonCode;
/**
 * 현재 보류의 재배송비 결제 요청 시각(deliveryHold.paymentRequestedAt, ISO8601). 요청 전(칸 없음·null)이거나
 * 읽을 수 없는 값이면 null이다. 서버는 유료 고객 책임 보류를 '재배송 준비로 돌리기'(DELIVERY_HELD → PREPARING)할
 * 때 같은 트랜잭션에서 처음 한 번만 적는다.
 */
export declare function redeliveryPaymentRequestedAtOf(hold: unknown): string | null;
/**
 * 재배송비 결제 마지막 날(서울 날짜 YYYY-MM-DD). 결제 요청을 보낸 날은 세지 않으므로 요청일 + 3일이다.
 * 이 날 끝(23:59:59)까지 결제할 수 있다. 요청 시각이 없거나 잘못되면 null(fail closed).
 */
export declare function redeliveryFeePaymentDeadlineDateKST(paymentRequestedAt: unknown): string | null;
/**
 * 재배송비 미결제로 종결할 수 있게 되는 시각(UTC ms): 결제 요청일 + 4일의 서울 00:00.
 * 요청 시각이 없거나 잘못되면 null(fail closed — 종결할 수 없다).
 */
export declare function customerFaultClosureEligibleAtMs(paymentRequestedAt: unknown): number | null;
/** 서울 날짜 YYYY-MM-DD 또는 시각(ms)을 "11월 17일"처럼 쓴다. 잘못된 값이면 null. */
export declare function formatKoreanMonthDayKST(value: string | number | null | undefined): string | null;
//# sourceMappingURL=customer-fault-closure.d.ts.map