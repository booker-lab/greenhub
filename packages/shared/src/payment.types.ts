export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'

export type PayMethod = 'kakaopay' | 'naverpay' | 'card'

export interface Payment {
  id: string // Portone imp_uid
  orderId: string
  userId: string
  storeId: string
  amount: number
  payMethod: PayMethod
  status: PaymentStatus
  portoneImpUid: string
  portoneMerchantUid: string
  refundAmount: number | null
  refundedAt: string | null // ISO8601
  refundReason: string | null
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}

export interface PortonePaymentParams {
  pg: string // 'html5_inicis' | 'naverpay' | 'kakaopay'
  pay_method: string
  merchant_uid: string
  name: string
  amount: number
  buyer_name: string
  buyer_tel: string
  buyer_email: string
  buyer_addr: string
  buyer_postcode: string
}
