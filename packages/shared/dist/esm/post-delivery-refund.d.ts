/**
 * 배송 후 환불 공유 정의 — SSOT (계획서 docs/specs/post-delivery-refund-plan.md §2)
 *
 * 배송이 끝난 회차 주문을 판매자(배송 완료 7일까지)나 관리자(기한 없음)가 전액 환불할 때
 * API·판매자 앱·관리자 화면이 같은 사유 코드·라벨·기간을 쓰도록 여기서만 정의한다.
 * 손님 알림 사유 문구는 서버 고정 문구라 API(refund-notice-reasons)가 소유한다.
 */
import type { OrderStatus } from './order.types.js';
export type PostDeliveryRefundReasonCode = 'QUALITY_DAMAGED' | 'BROKEN' | 'WRONG_DELIVERY' | 'OTHER';
/** 사유 4종 배열 — DTO 검증(@IsIn)과 화면 선택지 순서에 재사용 */
export declare const POST_DELIVERY_REFUND_REASON_CODES: PostDeliveryRefundReasonCode[];
export declare const POST_DELIVERY_REFUND_REASON_LABEL: Record<PostDeliveryRefundReasonCode, string>;
/** 배송 후 환불을 시작할 수 있는 주문 상태(배송 완료로 표시된 주문) */
export declare const POST_DELIVERY_REFUNDABLE_STATUSES: OrderStatus[];
/** 판매자가 직접 환불할 수 있는 기간(일). 기준 시각은 정산 settledAt(배송 완료 시각)이다. */
export declare const POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS = 7;
/** 환불 메모 최대 글자 수 */
export declare const POST_DELIVERY_REFUND_MEMO_MAX_LENGTH = 200;
export type PostDeliveryRefundActorRole = 'seller' | 'admin';
/**
 * 주문 문서의 postDeliveryRefund 칸. cancellation(취소 진행 상태)과 따로 둔다 —
 * cancellation은 재시도 기록 때 통째로 다시 쓰이므로 사유·메모가 지워질 수 있다.
 */
export interface PostDeliveryRefundRecord {
    reasonCode: PostDeliveryRefundReasonCode;
    memo: string;
    actorRole: PostDeliveryRefundActorRole;
    actorId: string;
    /** 환불 시작 직전 주문 상태 */
    previousStatus: OrderStatus;
    /** 환불한 금액(본 결제 전액) */
    amount: number;
    requestedAt: string;
    completedAt: string | null;
}
/**
 * 판매자 직접 환불 기간 안인지 판정한다. settledAt이 없거나 미래·잘못된 값이면 false(fail closed).
 * 경계: 정확히 7일이 지난 순간부터 기간 밖이다(정산 확정 배치의 `settledAt < 지금 - 7일`과 같은 경계).
 */
export declare function isWithinSellerRefundWindow(settledAtMs: number | null | undefined, nowMs: number): boolean;
//# sourceMappingURL=post-delivery-refund.d.ts.map