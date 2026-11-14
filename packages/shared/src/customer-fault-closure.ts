/**
 * 고객 사유 종결(환불 없음) 공유 정의 — SSOT
 *
 * 회차 직배송 주문이 고객 책임 사유로 배송 보류됐고 손님이 수령을 거부했거나(RECEIPT_REFUSED)
 * 재배송비를 기한(결제 요청을 보낸 날 다음 날부터 3일째 되는 날 끝)까지 결제하지 않으면, 판매자가 환불 없이
 * 주문을 종결(CLOSED_UNDELIVERED)할 수 있다. 기한은 보류한 때가 아니라 판매자가 '재배송 준비로 돌리기'로
 * 손님에게 결제 요청(ORDER_REDELIVERY_PAYMENT_REQUESTED)을 보낸 때(deliveryHold.paymentRequestedAt)부터
 * 센다(2026-11-14 사용자 결정 S-15). 요청 전에는 재배송비 미결제로 종결할 수 없다. 살아 있는 꽃이라 청약철회가 제한된다는 점은
 * 구매 때 고지한다. API(판정)·판매자 앱(버튼·안내)·소비자 앱(안내 문구)이 같은 날짜 계산을 쓰도록
 * 여기서만 정의한다.
 */
import type { DeliveryHoldReasonCode } from './order.types.js'

/** 종결 사유. 수령 거부는 바로, 그 밖의 고객 책임 보류는 재배송비 결제 기한이 지나야 종결할 수 있다. */
export type CustomerFaultClosureReasonCode = 'RECEIPT_REFUSED' | 'REDELIVERY_FEE_UNPAID'

export type CustomerFaultClosureActorRole = 'seller' | 'admin'

/** 판매자가 손님과 연락한 내용을 남기는 메모의 최대 글자 수. 손님에게는 보내지 않는다. */
export const CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH = 200

/** 재배송비를 결제할 수 있는 날 수. 결제 요청을 보낸 날은 세지 않는다(요청일 + 3일째 되는 날 끝까지). */
export const REDELIVERY_FEE_PAYMENT_DAYS = 3

/** 종결할 수 없는 보류 사유: 기상(고객 책임 아님)·상품 파손(판매자·기사 책임, 취소·환불로만 끝남). */
const NON_CLOSABLE_HOLD_REASONS: readonly DeliveryHoldReasonCode[] = ['WEATHER', 'PRODUCT_DAMAGED']

/** 주문 문서의 customerFaultClosure 칸. 종결한 주문에만 있다. */
export interface CustomerFaultClosureRecord {
  reasonCode: CustomerFaultClosureReasonCode
  /** 종결한 보류의 heldAt(ISO8601) */
  heldAt: string
  /** 그 보류의 재배송비(원). 결제되지 않았으므로 받은 돈이 아니다. */
  redeliveryFee: number | null
  actorRole: CustomerFaultClosureActorRole
  actorId: string
  /** 판매자가 손님과 연락한 기록(내부용) */
  memo: string
  closedAt: string // ISO8601
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
export type CustomerFaultClosureBlockReason =
  | 'OK'
  | 'ALREADY_CLOSED'
  | 'NOT_ROUND_ORDER'
  | 'NOT_DIRECT_DELIVERY'
  | 'NOT_HELD'
  | 'HOLD_REASON_NOT_ELIGIBLE'
  | 'NOT_CUSTOMER_RESPONSIBLE'
  | 'INVALID_HOLD'
  | 'CANCELLATION_IN_PROGRESS'
  | 'REDELIVERY_FEE_PAID'
  | 'REDELIVERY_PAYMENT_NEEDS_REVIEW'
  | 'PAYMENT_NOT_REQUESTED'
  | 'PAYMENT_WINDOW_OPEN'
  | 'REDELIVERY_PAYMENT_IN_PROGRESS'

/** GET stores/:storeId/orders/:orderId/customer-fault-closure 응답 */
export interface CustomerFaultClosureEligibility {
  eligible: boolean
  reason: CustomerFaultClosureBlockReason
  /** 종결하면 남길 사유. 고객 책임 보류가 아니면 null */
  closureReasonCode: CustomerFaultClosureReasonCode | null
  /**
   * 재배송비 미결제로 종결할 수 있게 되는 시각(ISO8601). 수령 거부는 보류 시각과 같다.
   * 그 밖의 사유는 결제 요청 전이면 null이다.
   */
  eligibleAt: string | null
  /** 재배송비 결제 마지막 날(서울 YYYY-MM-DD). 결제 요청 전이면 null이다. */
  paymentDeadlineDate: string | null
  redeliveryFee: number | null
  /**
   * 이미 종결한 주문(ALREADY_CLOSED)인데 정산이 없으면 true. 종결 뒤 정산 생성이 실패한 경우라
   * 같은 종결 요청(POST)을 다시 보내 정산만 맞춘다. 그 밖의 판정에서는 없거나 false다.
   */
  settlementMissing?: boolean
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 고객 사유 종결을 검토할 수 있는 보류 사유인지. 알 수 없는 값은 false다. */
export function isCustomerFaultClosableHoldReason(reasonCode: unknown): boolean {
  return (
    typeof reasonCode === 'string' &&
    reasonCode.length > 0 &&
    !(NON_CLOSABLE_HOLD_REASONS as readonly string[]).includes(reasonCode)
  )
}

/** 보류 사유로 정한 종결 사유. 수령 거부만 따로 두고 나머지는 재배송비 미결제다. */
export function customerFaultClosureReasonFor(
  holdReasonCode: unknown,
): CustomerFaultClosureReasonCode {
  return holdReasonCode === 'RECEIPT_REFUSED' ? 'RECEIPT_REFUSED' : 'REDELIVERY_FEE_UNPAID'
}

function parseMillis(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** 주어진 시각이 속한 서울 날짜의 00:00(UTC 기준 ms). */
function seoulMidnightOf(atMs: number): number {
  const shifted = atMs + KST_OFFSET_MS
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - KST_OFFSET_MS
}

/**
 * 현재 보류의 재배송비 결제 요청 시각(deliveryHold.paymentRequestedAt, ISO8601). 요청 전(칸 없음·null)이거나
 * 읽을 수 없는 값이면 null이다. 서버는 유료 고객 책임 보류를 '재배송 준비로 돌리기'(DELIVERY_HELD → PREPARING)할
 * 때 같은 트랜잭션에서 처음 한 번만 적는다.
 */
export function redeliveryPaymentRequestedAtOf(hold: unknown): string | null {
  if (typeof hold !== 'object' || hold === null) return null
  const value = (hold as Record<string, unknown>)['paymentRequestedAt']
  return typeof value === 'string' && parseMillis(value) !== null ? value : null
}

/**
 * 재배송비 결제 마지막 날(서울 날짜 YYYY-MM-DD). 결제 요청을 보낸 날은 세지 않으므로 요청일 + 3일이다.
 * 이 날 끝(23:59:59)까지 결제할 수 있다. 요청 시각이 없거나 잘못되면 null(fail closed).
 */
export function redeliveryFeePaymentDeadlineDateKST(paymentRequestedAt: unknown): string | null {
  const requestedAtMs = parseMillis(paymentRequestedAt)
  if (requestedAtMs === null) return null
  const deadlineStart = seoulMidnightOf(requestedAtMs) + REDELIVERY_FEE_PAYMENT_DAYS * DAY_MS
  return new Date(deadlineStart + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 재배송비 미결제로 종결할 수 있게 되는 시각(UTC ms): 결제 요청일 + 4일의 서울 00:00.
 * 요청 시각이 없거나 잘못되면 null(fail closed — 종결할 수 없다).
 */
export function customerFaultClosureEligibleAtMs(paymentRequestedAt: unknown): number | null {
  const requestedAtMs = parseMillis(paymentRequestedAt)
  if (requestedAtMs === null) return null
  return seoulMidnightOf(requestedAtMs) + (REDELIVERY_FEE_PAYMENT_DAYS + 1) * DAY_MS
}

/** 서울 날짜 YYYY-MM-DD 또는 시각(ms)을 "11월 17일"처럼 쓴다. 잘못된 값이면 null. */
export function formatKoreanMonthDayKST(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  let dateStr: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    dateStr = new Date(value + KST_OFFSET_MS).toISOString().slice(0, 10)
  } else {
    dateStr = value
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) return null
  return `${Number(match[2])}월 ${Number(match[3])}일`
}
