import type { ClientOrderRequestId } from './sale-round.types.js';
export type OrderStatus = 'PENDING' | 'RECRUITING' | 'CONFIRMED' | 'ACCEPTED' | 'PREPARING' | 'DELIVERING' | 'DELIVERY_HELD' | 'HUB_ARRIVED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED' | 'REVIEWED';
export type DeliveryMethod = 'direct' | 'hub' | 'parcel';
export type SaleType = 'normal' | 'group';
export interface DeliveryAddress {
    address: string;
    addressDetail: string;
    zipCode: string;
}
export interface GroupBuyConsent {
    agreed: true;
    agreedAt: string;
    userId: string;
}
export interface OrderItemSnapshot {
    roundItemId: string | null;
    productId: string;
    productName: string;
    productImageUrl: string | null;
    unitPrice: number;
    quantity: number;
    subtotalAmount: number;
}
export interface OrderAcquisitionSnapshot {
    source: 'carrot' | 'direct' | 'unknown';
    campaign: string | null;
    content: string | null;
    landingUrl: string | null;
    capturedAt: string;
}
export interface DeliveryHoldSnapshot {
    heldAt: string;
    reasonCode: 'WEATHER' | 'ACCESS_UNAVAILABLE' | 'ADDRESS_ISSUE' | 'CUSTOMER_UNREACHABLE' | 'OTHER';
    reasonMessage: string;
    customerResponsible: boolean;
    redeliveryFee: number | null;
    nextContactAt: string | null;
    nextDeliveryAt: string | null;
    resolvedAt: string | null;
}
export interface MarketingConsentInput {
    agreed: boolean;
    channels: Array<'alimtalk' | 'sms'>;
    copyVersion: string;
    agreedAt?: string;
}
export interface Order {
    id: string;
    orderNumber?: string;
    schemaVersion?: 1 | 2;
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
    hubId: string | null;
    pickupCode: string | null;
    totalAmount: number;
    requestedDeliveryDate: string | null;
    preparedAt: string | null;
    cancelReason: string | null;
    groupBuyConsent: GroupBuyConsent | null;
    roundId?: string | null;
    roundName?: string | null;
    orderItems?: OrderItemSnapshot[];
    acquisition?: OrderAcquisitionSnapshot | null;
    deliveryHold?: DeliveryHoldSnapshot | null;
    deliveryPhone?: string | null;
    deliveryPhotoIds?: string[];
    createdAt: string;
    updatedAt: string;
    productName?: string;
    buyerName?: string;
    address?: string;
    buyerPhone?: string | null;
    sellerPhone?: string | null;
    hubName?: string | null;
    hubAddress?: string | null;
}
export interface DailyCap {
    id: string;
    storeId: string;
    date: string;
    totalCap: number;
    usedSlots: number;
}
export interface CreateOrderRequest {
    clientOrderRequestId?: ClientOrderRequestId;
    productId: string;
    quantity: number;
    saleType: SaleType;
    deliveryMethod: DeliveryMethod;
    hubId?: string;
    deliveryAddress: DeliveryAddress;
    requestedDeliveryDate?: string;
    groupBuyConsent?: {
        agreed: true;
        agreedAt: string;
    };
    roundId?: string;
    roundItems?: Array<{
        roundItemId: string;
        quantity: number;
    }>;
    deliveryPhone: string;
    marketingConsent?: MarketingConsentInput;
    acquisition?: OrderAcquisitionSnapshot;
}
//# sourceMappingURL=order.types.d.ts.map