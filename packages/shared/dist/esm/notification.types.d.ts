export type NotificationChannel = 'alimtalk' | 'fcm';
export type NotificationStatus = 'pending' | 'sent' | 'failed';
export type NotificationTemplateCode = 'ORDER_ACCEPTED' | 'ORDER_PREPARING' | 'ORDER_DELIVERING' | 'ORDER_HUB_ARRIVED' | 'ORDER_DELIVERED' | 'ORDER_CANCELLED' | 'GROUP_JOINED' | 'GROUP_DEADLINE_SOON' | 'GROUP_CONFIRMED' | 'GROUP_CANCELLED_LACK' | 'GROUP_CANCELLED_SELF' | 'GROUP_PREPARING' | 'GROUP_DELIVERING' | 'GROUP_DELIVERED';
export interface Notification {
    id: string;
    userId: string;
    orderId: string | null;
    channel: NotificationChannel;
    templateCode: NotificationTemplateCode;
    variables: Record<string, string>;
    message: string;
    phone: string | null;
    fcmToken: string | null;
    status: NotificationStatus;
    sentAt: string | null;
    errorMessage: string | null;
    createdAt: string;
}
export interface NotificationSummary {
    id: string;
    templateCode: NotificationTemplateCode;
    message: string;
    orderId: string | null;
    sentAt: string;
}
//# sourceMappingURL=notification.types.d.ts.map