export type OrderStatus = 'PENDING' | 'RECRUITING' | 'CONFIRMED' | 'ACCEPTED' | 'PREPARING' | 'DELIVERING' | 'HUB_ARRIVED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED' | 'REVIEWED';
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
export interface Order {
    id: string;
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
}
//# sourceMappingURL=order.types.d.ts.map