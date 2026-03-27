export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'

export type PayMethod = 'kakaopay' | 'naverpay' | 'card'

export interface Payment {
  id: string // orderId와 동일 (Portone V2 paymentId)
  orderId: string
  userId: string
  storeId: string
  amount: number
  payMethod: PayMethod | null
  status: PaymentStatus
  portonePaymentId: string     // Portone V2: paymentId (구 imp_uid)
  portoneTransactionId: string // Portone V2: transactionId (구 merchant_uid)
  refundAmount: number | null
  refundedAt: string | null // ISO8601
  refundReason: string | null
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}

// Portone V2 SDK requestPayment() 파라미터
export interface PortonePaymentParams {
  name: string    // 상품명
  amount: number  // 결제금액 (KRW)
  buyerName: string
}
