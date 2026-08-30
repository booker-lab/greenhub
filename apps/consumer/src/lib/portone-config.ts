export type PortonePaymentMethod = 'kakaopay' | 'naverpay';

export type PortonePublicConfiguration = {
  portoneStoreId: string;
  channelKey: string;
  easyPayProvider: 'KAKAOPAY' | 'NAVERPAY';
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function readPortonePaymentConfiguration(
  paymentMethod: PortonePaymentMethod,
): PortonePublicConfiguration {
  const portoneStoreId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
  const channelKey =
    paymentMethod === 'naverpay'
      ? process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY
      : process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY;

  if (!isNonEmptyString(portoneStoreId) || !isNonEmptyString(channelKey)) {
    throw new Error('결제 설정을 확인할 수 없습니다.');
  }

  return {
    portoneStoreId,
    channelKey,
    easyPayProvider: paymentMethod === 'naverpay' ? 'NAVERPAY' : 'KAKAOPAY',
  };
}
