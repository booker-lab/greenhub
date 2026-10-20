import type { PortonePaymentMethod } from '@/lib/portone-config';

// 채널 키가 없는 결제수단은 선택지에서 숨긴다(카카오페이는 기본 결제수단이라 항상 보인다).
const NAVERPAY_ENABLED = !!process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY;
const CARD_ENABLED = !!process.env.NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY;

export interface PaymentMethodOption {
  method: PortonePaymentMethod;
  label: string;
  dot: string;
}

export const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { method: 'kakaopay', label: '카카오페이', dot: '#FEE500' },
  ...(NAVERPAY_ENABLED
    ? [{ method: 'naverpay' as PortonePaymentMethod, label: '네이버페이', dot: '#03C75A' }]
    : []),
  ...(CARD_ENABLED
    ? [{ method: 'card' as PortonePaymentMethod, label: '신용·체크카드', dot: '#3182F6' }]
    : []),
];

export function paymentButtonLabel(method: PortonePaymentMethod): string {
  if (method === 'naverpay') return '네이버페이로 결제하기';
  if (method === 'card') return '카드로 결제하기';
  return '카카오페이로 결제하기';
}
