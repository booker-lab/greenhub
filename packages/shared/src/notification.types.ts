export type NotificationChannel = 'alimtalk' | 'sms' | 'fcm'

export type NotificationStatus = 'pending' | 'sent' | 'failed'

export type NotificationTemplateCode =
  // 일반 판매
  | 'ORDER_ACCEPTED'
  | 'ORDER_PREPARING'
  | 'ORDER_DELIVERING'
  | 'ORDER_DELIVERY_HELD'
  | 'ORDER_REDELIVERY_PAYMENT_REQUESTED'
  | 'ORDER_REDELIVERY_SCHEDULED'
  | 'ORDER_HUB_ARRIVED'
  | 'ORDER_DELIVERED'
  | 'ORDER_CANCELLED'
  | 'ROUND_ORDER_CONFIRMED'
  | 'OPERATION_ISSUE_CREATED'
  | 'CUSTOMER_NOTICE_FAILED'
  // 공동구매
  | 'GROUP_JOINED'
  | 'GROUP_DEADLINE_SOON'
  | 'GROUP_CONFIRMED'
  | 'GROUP_CANCELLED_LACK'
  | 'GROUP_CANCELLED_SELF'
  | 'GROUP_PREPARING'
  | 'GROUP_DELIVERING'
  | 'GROUP_DELIVERED'

export interface Notification {
  id: string
  userId: string
  orderId: string | null
  channel: NotificationChannel
  templateCode: NotificationTemplateCode
  variables: Record<string, string>
  message: string
  phone: string | null
  fcmToken: string | null
  status: NotificationStatus
  attemptCount?: number
  maxAttempts?: number
  fallbackChannel?: Extract<NotificationChannel, 'sms'> | null
  sentAt: string | null // ISO8601
  errorMessage: string | null
  createdAt: string // ISO8601
}

export interface NotificationSummary {
  id: string
  templateCode: NotificationTemplateCode
  message: string
  orderId: string | null
  sentAt: string // ISO8601
}
