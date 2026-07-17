export type SaleRoundStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'OPEN'
  | 'CLOSED'
  | 'COMPLETED'
  | 'CANCELLED'

export type SaleRoundCloseReason = 'SCHEDULE_ENDED' | 'CAPACITY' | 'MANUAL'

export type SaleRoundCancellationStatus =
  | 'CANCELLING'
  | 'LOCAL_FAILED'
  | 'COMPLETED'

export interface SaleRoundCancellation {
  status: SaleRoundCancellationStatus
  reason: string
  failedOrderId: string | null
  updatedAt: string // ISO8601
  completedAt: string | null // ISO8601
}

export type SaleRoundItemStatus = 'ACTIVE' | 'HIDDEN' | 'SOLD_OUT' | 'CLOSED'

export type CheckoutReservationStatus =
  | 'HELD'
  | 'CONSUMED'
  | 'RELEASED'
  | 'EXPIRED'

export type ClientOrderRequestId = string

export type OrderChargeType = 'REDELIVERY_FEE'

export type OrderChargeStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'

export type OperationIssueType =
  | 'PAYMENT_LOOKUP_FAILED'
  | 'AUTO_REFUND_FAILED'
  | 'CUSTOMER_NOTICE_FAILED'
  | 'REDELIVERY_FAILED'
  | 'RETENTION_DELETE_FAILED'

export type OperationIssueStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED'

export type OperationIssueSeverity = 'info' | 'warning' | 'critical'

export type OperationIssueActionType = 'RETRY_REFUND' | 'RESEND_SMS'

export interface SaleRoundDeliveryRegion {
  id: string
  label: string
  province: string
  city: string
  enabled: boolean
}

export interface SaleRoundSchedule {
  orderOpenAt: string // ISO8601
  orderCloseAt: string // ISO8601
  auctionAt: string // ISO8601
  deliveryStartAt: string // ISO8601
  deliveryEndAt: string // ISO8601
  timezone: 'Asia/Seoul'
}

export interface SaleRoundLimits {
  maxDeliveryAddresses: number
  maxItemQuantity: number
}

export interface SaleRoundCounters {
  reservedDeliveryAddresses: number
  reservedItemQuantity: number
  orderedDeliveryAddresses: number
  orderedItemQuantity: number
  heldOrderCount: number
}

export interface SaleRound {
  id: string
  storeId: string
  name: string
  status: SaleRoundStatus
  closeReason: SaleRoundCloseReason | null
  cancellation: SaleRoundCancellation | null
  schedule: SaleRoundSchedule
  deliveryRegion: SaleRoundDeliveryRegion
  limits: SaleRoundLimits
  counters: SaleRoundCounters
  carrotLandingUrl: string | null
  cancelledAt: string | null // ISO8601
  completedAt: string | null // ISO8601
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}

export interface SaleRoundItem {
  id: string
  roundId: string
  storeId: string
  productId: string
  productNameSnapshot: string
  productImageUrlSnapshot: string | null
  roundPrice: number
  saleLimitQuantity: number
  reservedQuantity: number
  orderedQuantity: number
  displayOrder: number
  status: SaleRoundItemStatus
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}

export interface CheckoutReservationItem {
  roundItemId: string
  productId: string
  quantity: number
  unitPrice: number
}

export interface CheckoutReservation {
  id: string
  roundId: string
  storeId: string
  userId: string
  orderId: string | null
  paymentId: string | null
  status: CheckoutReservationStatus
  addressKey: string
  deliveryAddressCount: 1
  itemQuantityTotal: number
  items: CheckoutReservationItem[]
  idempotencyKey: string
  expiresAt: string // ISO8601
  consumedAt: string | null // ISO8601
  releasedAt: string | null // ISO8601
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}

export interface OrderCharge {
  id: string
  orderId: string
  storeId: string
  userId: string
  type: OrderChargeType
  status: OrderChargeStatus
  amount: number
  reason: string
  attemptNumber: number
  customerResponsible: boolean
  portonePaymentId: string | null
  idempotencyKey: string
  paidAt: string | null // ISO8601
  failedAt: string | null // ISO8601
  refundedAt: string | null // ISO8601
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}

export interface OperationIssueAction {
  actorId: string
  actionType: OperationIssueActionType
  performedAt: string // ISO8601
  status: 'SUCCEEDED' | 'FAILED'
  failureReason?: string
}

export interface OperationIssue {
  id: string
  storeId: string
  orderId: string | null
  paymentId: string | null
  type: OperationIssueType
  status: OperationIssueStatus
  severity: OperationIssueSeverity
  title: string
  message: string
  idempotencyKey: string
  latestSnapshot: Record<string, unknown>
  actions: OperationIssueAction[]
  resolvedAt: string | null // ISO8601
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}
