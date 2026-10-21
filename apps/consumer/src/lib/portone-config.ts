export type PortonePaymentMethod = 'kakaopay' | 'naverpay' | 'card';

export type PortonePublicConfiguration = {
  portoneStoreId: string;
  channelKey: string;
  paymentMethod: PortonePaymentMethod;
};

/** 결제창에 넘길 구매자 정보. 카드(토스페이먼츠) 결제창이 기본값으로 쓴다. */
export type PortoneBuyer = {
  name?: string | null;
  phone?: string | null;
};

export type PortonePayMethodRequest =
  | { payMethod: 'EASY_PAY'; easyPay: { easyPayProvider: 'KAKAOPAY' | 'NAVERPAY' } }
  | { payMethod: 'CARD'; customer?: { fullName?: string; phoneNumber?: string } };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Next는 `process.env.NEXT_PUBLIC_*`를 글자 그대로 쓴 곳만 빌드 시 값으로 바꾸므로 키마다 따로 읽는다.
function readChannelKey(paymentMethod: PortonePaymentMethod): string | undefined {
  if (paymentMethod === 'card') return process.env.NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY;
  if (paymentMethod === 'naverpay') return process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY;
  return process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY;
}

export function readPortonePaymentConfiguration(
  paymentMethod: PortonePaymentMethod,
): PortonePublicConfiguration {
  const portoneStoreId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
  const channelKey = readChannelKey(paymentMethod);

  if (!isNonEmptyString(portoneStoreId) || !isNonEmptyString(channelKey)) {
    throw new Error('결제 설정을 확인할 수 없습니다.');
  }

  return { portoneStoreId, channelKey, paymentMethod };
}

/**
 * 결제수단별 결제창 파라미터를 만든다.
 * 카드는 토스페이먼츠 결제창(`CARD`)이고 간편결제 정보를 넣지 않는다.
 * 구매자 이름·전화는 카드 결제창에만 넘기고, 비어 있으면 뺀다.
 */
export function buildPortonePayMethodRequest(
  paymentMethod: PortonePaymentMethod,
  buyer: PortoneBuyer = {},
): PortonePayMethodRequest {
  if (paymentMethod !== 'card') {
    return {
      payMethod: 'EASY_PAY',
      easyPay: { easyPayProvider: paymentMethod === 'naverpay' ? 'NAVERPAY' : 'KAKAOPAY' },
    };
  }

  const fullName = isNonEmptyString(buyer.name) ? buyer.name.trim() : undefined;
  const digits = isNonEmptyString(buyer.phone) ? buyer.phone.replace(/\D/g, '') : '';
  const phoneNumber = digits.length > 0 ? digits : undefined;
  if (!fullName && !phoneNumber) return { payMethod: 'CARD' };
  return {
    payMethod: 'CARD',
    customer: {
      ...(fullName ? { fullName } : {}),
      ...(phoneNumber ? { phoneNumber } : {}),
    },
  };
}
