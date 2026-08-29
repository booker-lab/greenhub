'use client';

import type { CreateOrderRequest } from '@greenhub/shared';
import { useRef, useState } from 'react';
import { type CartItem, isRoundCartItem, type RoundCartItem } from '@/hooks/useCart';
import { getApiBaseUrl } from '@/lib/api-base-url';

export type PaymentMethod = 'kakaopay' | 'naverpay';
export type PaymentState = 'idle' | 'creating' | 'paying' | 'done' | 'error';

interface BasePaymentOptions {
  storeId: string;
  accessToken: string;
  paymentMethod: PaymentMethod;
}

export type RoundPaymentOrderRequest = Pick<
  CreateOrderRequest,
  'deliveryAddress' | 'deliveryPhone'
> &
  Partial<Pick<CreateOrderRequest, 'requestedDeliveryDate' | 'marketingConsent' | 'acquisition'>>;

export type UsePaymentOptions = BasePaymentOptions &
  (
    | {
        orderRequest: CreateOrderRequest;
        roundItems?: undefined;
      }
    | {
        orderRequest: RoundPaymentOrderRequest;
        roundItems: RoundCartItem[];
      }
  );

interface UsePaymentResult {
  state: PaymentState;
  orderId: string | null;
  error: string | null;
  requestPayment: () => Promise<void>;
}

interface PreparedOrderRequest {
  body: CreateOrderRequest & { clientOrderRequestId: string };
  expectedAmount?: number;
}

interface OrderPaymentResponse {
  orderId: string;
  paymentId: string;
  name: string;
  amount: number;
}

const MAX_IDENTIFIER_LENGTH = 128;
const UNSAFE_IDENTIFIER_CHARACTERS = '/?#\\';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeIdentifier(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) {
    return false;
  }
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || UNSAFE_IDENTIFIER_CHARACTERS.includes(character);
  });
}

function isPositiveQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isValidRoundPaymentItem(value: unknown, storeId: string): value is RoundCartItem {
  if (!isRecord(value)) return false;
  const item = value as unknown as CartItem;
  return (
    isRoundCartItem(item) &&
    isSafeIdentifier(item.productId) &&
    isNonEmptyString(item.name) &&
    typeof item.image === 'string' &&
    isPositiveQuantity(item.quantity) &&
    item.saleType === 'normal' &&
    item.deliveryMethod === 'direct' &&
    item.storeId === storeId &&
    isMoney(item.price) &&
    isMoney(item.roundPrice)
  );
}

function prepareRoundOrderRequest(
  options: Extract<UsePaymentOptions, { roundItems: RoundCartItem[] }>,
  clientOrderRequestId: string,
): PreparedOrderRequest {
  const { orderRequest, roundItems, storeId } = options;
  if (roundItems.length === 0) {
    throw new Error('결제할 회차 상품이 없습니다.');
  }
  if (!roundItems.every((item) => isValidRoundPaymentItem(item, storeId))) {
    throw new Error('검증된 회차 상품 정보를 확인할 수 없습니다.');
  }

  const firstItem = roundItems[0];
  if (!firstItem || roundItems.some((item) => item.roundId !== firstItem.roundId)) {
    throw new Error('같은 회차 상품만 함께 결제할 수 있습니다.');
  }
  const roundItemIds = roundItems.map((item) => item.roundItemId);
  if (new Set(roundItemIds).size !== roundItemIds.length) {
    throw new Error('같은 회차 상품을 중복으로 결제할 수 없습니다.');
  }

  const expectedAmount = roundItems.reduce((sum, item) => {
    const subtotal = item.roundPrice * item.quantity;
    if (!Number.isSafeInteger(subtotal) || subtotal < 0) {
      throw new Error('회차 상품 금액을 확인할 수 없습니다.');
    }
    return sum + subtotal;
  }, 0);
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) {
    throw new Error('회차 주문 금액을 확인할 수 없습니다.');
  }

  return {
    body: {
      productId: firstItem.productId,
      quantity: firstItem.quantity,
      saleType: 'normal',
      deliveryMethod: 'direct',
      deliveryAddress: orderRequest.deliveryAddress,
      deliveryPhone: orderRequest.deliveryPhone,
      ...(orderRequest.requestedDeliveryDate
        ? { requestedDeliveryDate: orderRequest.requestedDeliveryDate }
        : {}),
      ...(orderRequest.marketingConsent ? { marketingConsent: orderRequest.marketingConsent } : {}),
      ...(orderRequest.acquisition ? { acquisition: orderRequest.acquisition } : {}),
      roundId: firstItem.roundId,
      roundItems: roundItems.map((item) => ({
        roundItemId: item.roundItemId,
        quantity: item.quantity,
      })),
      clientOrderRequestId,
    },
    expectedAmount,
  };
}

function prepareOrderRequest(
  options: UsePaymentOptions,
  clientOrderRequestId: string,
): PreparedOrderRequest {
  if (options.roundItems !== undefined) {
    return prepareRoundOrderRequest(
      options as Extract<UsePaymentOptions, { roundItems: RoundCartItem[] }>,
      clientOrderRequestId,
    );
  }
  return {
    body: {
      ...options.orderRequest,
      clientOrderRequestId,
    },
  };
}

function readOrderPaymentResponse(value: unknown, expectedAmount?: number): OrderPaymentResponse {
  if (!isRecord(value) || !isSafeIdentifier(value.orderId)) {
    throw new Error('주문 응답의 결제 식별자를 확인할 수 없습니다.');
  }
  if ('paymentId' in value && value.paymentId !== value.orderId) {
    throw new Error('주문 응답에 서로 다른 결제 식별자가 포함되었습니다.');
  }

  const parameters = value.portonePaymentParams;
  if (
    !isRecord(parameters) ||
    !isNonEmptyString(parameters.name) ||
    !isMoney(parameters.amount) ||
    parameters.amount <= 0
  ) {
    throw new Error('주문 응답의 결제 정보를 확인할 수 없습니다.');
  }
  if ('paymentId' in parameters && parameters.paymentId !== value.orderId) {
    throw new Error('주문 응답에 서로 다른 결제 식별자가 포함되었습니다.');
  }
  if (expectedAmount !== undefined && parameters.amount !== expectedAmount) {
    throw new Error('서버가 반환한 결제 금액이 회차 주문 금액과 일치하지 않습니다.');
  }

  return {
    orderId: value.orderId,
    paymentId: value.orderId,
    name: parameters.name,
    amount: parameters.amount,
  };
}

function readPaymentConfiguration(paymentMethod: PaymentMethod) {
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
    easyPayProvider: paymentMethod === 'naverpay' ? ('NAVERPAY' as const) : ('KAKAOPAY' as const),
  };
}

export function usePayment(options: UsePaymentOptions): UsePaymentResult {
  const [state, setState] = useState<PaymentState>('idle');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paymentAttemptId = useRef<string | null>(null);
  const currentState = useRef<PaymentState>('idle');

  function transition(nextState: PaymentState) {
    currentState.current = nextState;
    setState(nextState);
  }

  async function requestPayment() {
    if (currentState.current !== 'idle' && currentState.current !== 'error') return;
    transition('creating');
    setError(null);
    paymentAttemptId.current ??= crypto.randomUUID();

    try {
      const prepared = prepareOrderRequest(options, paymentAttemptId.current);
      const res = await fetch(
        `${getApiBaseUrl()}/stores/${encodeURIComponent(options.storeId)}/orders`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.accessToken}`,
          },
          body: JSON.stringify(prepared.body),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? '주문 생성 실패');
      }
      const payment = readOrderPaymentResponse(await res.json(), prepared.expectedAmount);
      const configuration = readPaymentConfiguration(options.paymentMethod);
      setOrderId(payment.orderId);

      transition('paying');
      const PortOne = await import('@portone/browser-sdk/v2');
      const response = await PortOne.requestPayment({
        storeId: configuration.portoneStoreId,
        paymentId: payment.paymentId,
        orderName: payment.name,
        totalAmount: payment.amount,
        currency: 'KRW' as const,
        channelKey: configuration.channelKey,
        payMethod: 'EASY_PAY',
        easyPay: { easyPayProvider: configuration.easyPayProvider },
      });

      if (response && 'code' in response) {
        throw new Error(response.message ?? '결제가 취소되었습니다.');
      }

      transition('done');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '오류가 발생했습니다.';
      setError(message);
      transition('error');
    }
  }

  return { state, orderId, error, requestPayment };
}
