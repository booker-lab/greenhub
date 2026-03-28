export type OrderStatus =
  | 'PENDING'
  | 'RECRUITING'
  | 'CONFIRMED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'DELIVERING'
  | 'HUB_ARRIVED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REVIEWED'

export type DeliveryMethod = 'direct' | 'hub' | 'parcel'

export type SaleType = 'normal' | 'group'

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

export interface Order {
  id: string
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
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}

export interface DailyCap {
  id: string // '{storeId}_{YYYY-MM-DD}'
  storeId: string
  date: string // 'YYYY-MM-DD'
  totalCap: number
  usedSlots: number
}

export interface CreateOrderRequest {
  productId: string
  quantity: number
  saleType: SaleType
  deliveryMethod: DeliveryMethod
  hubId?: string                 // hub 배송 시 필수
  deliveryAddress: DeliveryAddress
  requestedDeliveryDate?: string // 일반 판매 전용 'YYYY-MM-DD'
  groupBuyConsent?: {
    agreed: true
    agreedAt: string // ISO8601
  }
}
