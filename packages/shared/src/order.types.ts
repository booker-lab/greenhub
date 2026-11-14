import type { GiftInfo, SelectedProductOption } from './benchmark.types.js'
import type { CustomerFaultClosureRecord } from './customer-fault-closure.js'
import type { PostDeliveryRefundRecord } from './post-delivery-refund.js'
import type { ClientOrderRequestId } from './sale-round.types.js'

export type OrderStatus =
  | 'PENDING'
  | 'RECRUITING'
  | 'CONFIRMED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'DELIVERING'
  | 'DELIVERY_HELD'
  | 'HUB_ARRIVED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REVIEWED'
  /**
   * 고객 사유 종결(환불 없음). 고객 책임 보류에서 수령 거부·재배송비 미결제로 판매자가 종결한
   * 회차 직배송 주문이다. 결제 금액은 정산되고 상품은 판매자가 처리한다. 취소(CANCELLED=환불)와
   * 다르며 이 상태에서 다른 상태로 가는 전이는 없다(apps/api/src/orders/customer-fault-closure.service.ts).
   */
  | 'CLOSED_UNDELIVERED'

export type DeliveryMethod = 'direct' | 'hub' | 'parcel'

export type SaleType = 'normal' | 'group'

/** 주문 요청사항(받는 분·토퍼 문구·배송 요청 등 자유 입력) 최대 글자 수 */
export const ORDER_REQUEST_NOTE_MAX_LENGTH = 200

export interface DeliveryAddress {
  address: string
  addressDetail: string
  zipCode: string
}

export interface GroupBuyConsent {
  agreed: true
  agreedAt: string // ISO8601
  userId: string
}

export interface OrderItemSnapshot {
  roundItemId: string | null
  productId: string
  productName: string
  productImageUrl: string | null
  unitPrice: number
  quantity: number
  subtotalAmount: number
  /** 고른 옵션(옵션 시트 기능). unitPrice에 이미 더해져 있다. */
  selectedOptions?: SelectedProductOption[]
}

export interface OrderAcquisitionSnapshot {
  source: 'carrot' | 'direct' | 'unknown'
  campaign: string | null
  content: string | null
  landingUrl: string | null
  capturedAt: string // ISO8601
}

/**
 * 배송 보류 사유 코드. 서버 DTO(apps/api/src/orders/dto/update-status.dto.ts)가 받는 값과 같다.
 * - PRODUCT_DAMAGED(상품 파손): 판매자·기사 책임이고 다시 배송하지 않는다. 기사가 배송 중에만 남긴다.
 * - RECEIPT_REFUSED(수령 거부): 고객 책임(단순 변심과 같음)이고 재배송비를 결제해야 다시 배송한다.
 */
export type DeliveryHoldReasonCode =
  | 'WEATHER'
  | 'ACCESS_UNAVAILABLE'
  | 'ADDRESS_ISSUE'
  | 'CUSTOMER_UNREACHABLE'
  | 'RECEIPT_REFUSED'
  | 'PRODUCT_DAMAGED'
  | 'OTHER'

/**
 * 재배송하지 않는 보류 사유. 이 보류는 주문 취소(전액 환불)로만 끝나고 재배송 준비·배송 재개로
 * 돌아가지 않는다(apps/api/src/orders/orders.helpers.ts deliveryTransitionViolation).
 */
export const NON_REDELIVERABLE_HOLD_REASONS: readonly DeliveryHoldReasonCode[] = [
  'PRODUCT_DAMAGED',
]

/** 재배송하지 않는(취소로만 끝나는) 보류 사유인지 확인한다. 알 수 없는 값은 false다. */
export function isNonRedeliverableHoldReason(reasonCode: unknown): boolean {
  return (
    typeof reasonCode === 'string' &&
    (NON_REDELIVERABLE_HOLD_REASONS as readonly string[]).includes(reasonCode)
  )
}

export interface DeliveryHoldSnapshot {
  heldAt: string // ISO8601
  reasonCode: DeliveryHoldReasonCode
  reasonMessage: string
  customerResponsible: boolean
  redeliveryFee: number | null
  nextContactAt: string | null // ISO8601
  nextDeliveryAt: string | null // ISO8601
  resolvedAt: string | null // ISO8601
  /**
   * 손님에게 재배송비 결제 요청을 보낸 시각(ISO8601). 유료 고객 책임 보류를 판매자가 '재배송 준비로 돌리기'
   * (DELIVERY_HELD → PREPARING)할 때 서버가 같은 트랜잭션에서 처음 한 번만 적는다(다시 요청해도 처음 값을 둔다).
   * 고객 사유 종결 기한은 이 시각부터 센다. 요청 전이거나 이 칸이 생기기 전 보류면 없거나 null이다.
   */
  paymentRequestedAt?: string | null // ISO8601
}

export type RedeliveryPaymentState =
  | 'NOT_REQUIRED'
  | 'MISSING'
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'MISMATCHED'

export interface RedeliveryPaymentActionability {
  required: boolean
  holdAt: string | null
  chargeId: string | null
  status: RedeliveryPaymentState
  canPay: boolean
  paid: boolean
  requiresRecovery: boolean
}

export interface MarketingConsentInput {
  agreed: boolean
  channels: Array<'alimtalk' | 'sms'>
  copyVersion: string
  agreedAt?: string // ISO8601
}

export interface Order {
  id: string
  orderNumber?: string               // YYYYMMDD-NNNNNN. 신규 발급분만 존재 — 기존 주문은 undefined (폴백 표시)
  schemaVersion?: 1 | 2
  storeId: string
  userId: string
  productId: string
  quantity: number
  saleType: SaleType
  status: OrderStatus
  deliveryMethod: DeliveryMethod
  deliveryFee: number
  deliveryAddress: DeliveryAddress
  isMetropolitan: boolean
  hubId: string | null               // hub 배송 선택 시 거점 ID
  pickupCode: string | null
  totalAmount: number
  requestedDeliveryDate: string | null // ISO8601
  preparedAt: string | null            // ISO8601 — 드라이버 수거 예정 시각 (판매자 설정)
  cancelReason: string | null
  groupBuyConsent: GroupBuyConsent | null
  roundId?: string | null
  roundName?: string | null
  orderItems?: OrderItemSnapshot[]
  acquisition?: OrderAcquisitionSnapshot | null
  deliveryHold?: DeliveryHoldSnapshot | null
  redeliveryPayment?: RedeliveryPaymentActionability
  deliveryPhone?: string | null
  requestNote?: string | null        // 소비자 요청사항 — 회차 주문만, 없으면 null
  deliveryPhotoIds?: string[]
  gift?: GiftInfo | null
  packageLabel?: string | null       // 포장 겉면 라벨 문구 — 회차 주문만, 선물이면 보내는 분 이름, 없으면 키가 없다
  postDeliveryRefund?: PostDeliveryRefundRecord | null // 배송 후 환불 기록 — 환불한 주문만 존재
  customerFaultClosure?: CustomerFaultClosureRecord | null // 고객 사유 종결 기록 — 종결한 주문만 존재
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
  // Denormalized fields — 드라이버 앱 실시간 표시용
  productName?: string
  buyerName?: string
  address?: string               // deliveryAddress.address + addressDetail 합산
  buyerPhone?: string | null
  sellerPhone?: string | null
  hubName?: string | null        // hub 배송 시 거점명
  hubAddress?: string | null     // hub 배송 시 거점 주소
}

export interface DailyCap {
  id: string // '{storeId}_{YYYY-MM-DD}'
  storeId: string
  date: string // 'YYYY-MM-DD'
  totalCap: number
  usedSlots: number
}

export interface CreateOrderRequest {
  clientOrderRequestId?: ClientOrderRequestId
  productId: string
  quantity: number          // 공동구매: 1 이상 maxPerPerson 이하 — 서비스 레이어에서 검증
  saleType: SaleType
  deliveryMethod: DeliveryMethod
  hubId?: string                 // hub 배송 시 필수
  deliveryAddress: DeliveryAddress
  requestedDeliveryDate?: string // 일반 판매 전용 'YYYY-MM-DD'
  groupBuyConsent?: {
    agreed: true
    agreedAt: string // ISO8601
  }
  roundId?: string
  roundItems?: Array<{
    roundItemId: string
    quantity: number
    /** 옵션 묶음마다 고른 선택지 id */
    optionChoiceIds?: string[]
  }>
  gift?: GiftInfo
  /** 포장 겉면 라벨 문구(선택, PACKAGE_LABEL_MAX_LENGTH 이하). 선물이면 보내지 않는다(보내는 분 이름이 라벨이 된다). */
  packageLabel?: string
  deliveryPhone: string
  requestNote?: string           // 선택 — ORDER_REQUEST_NOTE_MAX_LENGTH 이하
  marketingConsent?: MarketingConsentInput
  acquisition?: OrderAcquisitionSnapshot
}
