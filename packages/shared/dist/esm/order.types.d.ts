import type { GiftInfo, SelectedProductOption } from './benchmark.types.js';
import type { CustomerFaultClosureRecord } from './customer-fault-closure.js';
import type { PostDeliveryRefundRecord } from './post-delivery-refund.js';
import type { ClientOrderRequestId } from './sale-round.types.js';
export type OrderStatus = 'PENDING' | 'RECRUITING' | 'CONFIRMED' | 'ACCEPTED' | 'PREPARING' | 'DELIVERING' | 'DELIVERY_HELD' | 'HUB_ARRIVED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED' | 'REVIEWED'
/**
 * 고객 사유 종결(환불 없음). 고객 책임 보류에서 수령 거부·재배송비 미결제로 판매자가 종결한
 * 회차 직배송 주문이다. 결제 금액은 정산되고 상품은 판매자가 처리한다. 취소(CANCELLED=환불)와
 * 다르며 이 상태에서 다른 상태로 가는 전이는 없다(apps/api/src/orders/customer-fault-closure.service.ts).
 */
 | 'CLOSED_UNDELIVERED';
export type DeliveryMethod = 'direct' | 'hub' | 'parcel';
export type SaleType = 'normal' | 'group';
/** 주문 요청사항(받는 분·토퍼 문구·배송 요청 등 자유 입력) 최대 글자 수 */
export declare const ORDER_REQUEST_NOTE_MAX_LENGTH = 200;
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
    /** 고른 옵션(옵션 시트 기능). unitPrice에 이미 더해져 있다. */
    selectedOptions?: SelectedProductOption[];
}
export interface OrderAcquisitionSnapshot {
    source: 'carrot' | 'direct' | 'unknown';
    campaign: string | null;
    content: string | null;
    landingUrl: string | null;
    capturedAt: string;
}
/**
 * 배송 보류 사유 코드. 서버 DTO(apps/api/src/orders/dto/update-status.dto.ts)가 받는 값과 같다.
 * - PRODUCT_DAMAGED(상품 파손): 판매자·기사 책임이고 다시 배송하지 않는다. 기사가 배송 중에만 남긴다.
 * - RECEIPT_REFUSED(수령 거부): 고객 책임(단순 변심과 같음)이고 재배송비를 결제해야 다시 배송한다.
 */
export type DeliveryHoldReasonCode = 'WEATHER' | 'ACCESS_UNAVAILABLE' | 'ADDRESS_ISSUE' | 'CUSTOMER_UNREACHABLE' | 'RECEIPT_REFUSED' | 'PRODUCT_DAMAGED' | 'OTHER';
/**
 * 재배송하지 않는 보류 사유. 이 보류는 주문 취소(전액 환불)로만 끝나고 재배송 준비·배송 재개로
 * 돌아가지 않는다(apps/api/src/orders/orders.helpers.ts deliveryTransitionViolation).
 */
export declare const NON_REDELIVERABLE_HOLD_REASONS: readonly DeliveryHoldReasonCode[];
/** 재배송하지 않는(취소로만 끝나는) 보류 사유인지 확인한다. 알 수 없는 값은 false다. */
export declare function isNonRedeliverableHoldReason(reasonCode: unknown): boolean;
export interface DeliveryHoldSnapshot {
    heldAt: string;
    reasonCode: DeliveryHoldReasonCode;
    reasonMessage: string;
    customerResponsible: boolean;
    redeliveryFee: number | null;
    nextContactAt: string | null;
    nextDeliveryAt: string | null;
    resolvedAt: string | null;
}
export type RedeliveryPaymentState = 'NOT_REQUIRED' | 'MISSING' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'MISMATCHED';
export interface RedeliveryPaymentActionability {
    required: boolean;
    holdAt: string | null;
    chargeId: string | null;
    status: RedeliveryPaymentState;
    canPay: boolean;
    paid: boolean;
    requiresRecovery: boolean;
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
    redeliveryPayment?: RedeliveryPaymentActionability;
    deliveryPhone?: string | null;
    requestNote?: string | null;
    deliveryPhotoIds?: string[];
    gift?: GiftInfo | null;
    packageLabel?: string | null;
    postDeliveryRefund?: PostDeliveryRefundRecord | null;
    customerFaultClosure?: CustomerFaultClosureRecord | null;
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
        /** 옵션 묶음마다 고른 선택지 id */
        optionChoiceIds?: string[];
    }>;
    gift?: GiftInfo;
    /** 포장 겉면 라벨 문구(선택, PACKAGE_LABEL_MAX_LENGTH 이하). 선물이면 보내지 않는다(보내는 분 이름이 라벨이 된다). */
    packageLabel?: string;
    deliveryPhone: string;
    requestNote?: string;
    marketingConsent?: MarketingConsentInput;
    acquisition?: OrderAcquisitionSnapshot;
}
//# sourceMappingURL=order.types.d.ts.map