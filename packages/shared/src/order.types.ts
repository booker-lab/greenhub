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
  | 'REVIEWED';

export type DeliveryMethod = 'direct' | 'hub' | 'parcel';

export type SaleType = 'normal' | 'group';

export interface DeliveryAddress {
  address: string;
  addressDetail: string;
  zipCode: string;
}

export interface GroupBuyConsent {
  agreed: true;
  agreedAt: string; // ISO8601
  userId: string;
}

export interface Order {
  id: string;
  orderNumber?: string; // YYYYMMDD-NNNNNN. 신규 발급분만 존재 — 기존 주문은 undefined (폴백 표시)
  storeId: string;
  userId: string;
  productId: string;
  quantity: number;
  saleType: SaleType;
  status: OrderStatus;
  deliveryMethod: DeliveryMethod;
  deliveryFee: number;
  deliveryAddress: DeliveryAddress;
  isMetropolitan: boolean;
  hubId: string | null; // hub 배송 선택 시 거점 ID
  pickupCode: string | null;
  totalAmount: number;
  requestedDeliveryDate: string | null; // ISO8601
  preparedAt: string | null; // ISO8601 — 드라이버 수거 예정 시각 (판매자 설정)
  courierCompany?: string | null;
  trackingNumber?: string | null;
  cancelReason: string | null;
  groupBuyConsent: GroupBuyConsent | null;
  createdAt: string; // ISO8601
  updatedAt: string; // ISO8601
  // Denormalized fields — 드라이버 앱 실시간 표시용
  productName?: string;
  buyerName?: string;
  address?: string; // deliveryAddress.address + addressDetail 합산
  buyerPhone?: string | null;
  sellerPhone?: string | null;
  hubName?: string | null; // hub 배송 시 거점명
  hubAddress?: string | null; // hub 배송 시 거점 주소
}

export interface DailyCap {
  id: string; // '{storeId}_{YYYY-MM-DD}'
  storeId: string;
  date: string; // 'YYYY-MM-DD'
  totalCap: number;
  usedSlots: number;
}

export interface CreateOrderRequest {
  productId: string;
  quantity: number; // 공동구매: 1 이상 maxPerPerson 이하 — 서비스 레이어에서 검증
  saleType: SaleType;
  deliveryMethod: DeliveryMethod;
  hubId?: string; // hub 배송 시 필수
  deliveryAddress: DeliveryAddress;
  requestedDeliveryDate?: string; // 일반 판매 전용 'YYYY-MM-DD'
  groupBuyConsent?: {
    agreed: true;
    agreedAt: string; // ISO8601
  };
}
