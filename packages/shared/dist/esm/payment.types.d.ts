export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
export type PayMethod = 'kakaopay' | 'naverpay' | 'card';
export interface Payment {
    id: string;
    orderId: string;
    userId: string;
    storeId: string;
    amount: number;
    payMethod: PayMethod | null;
    status: PaymentStatus;
    portonePaymentId: string;
    portoneTransactionId: string;
    refundAmount: number | null;
    refundedAt: string | null;
    refundReason: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface PortonePaymentParams {
    name: string;
    amount: number;
    buyerName: string;
}
//# sourceMappingURL=payment.types.d.ts.map