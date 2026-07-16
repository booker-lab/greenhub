'use client';

import type { CreateOrderRequest } from '@greenhub/shared';
import { useRef, useState } from 'react';

export type PaymentMethod = 'kakaopay' | 'naverpay';
export type PaymentState = 'idle' | 'creating' | 'paying' | 'done' | 'error';

interface UsePaymentOptions {
  storeId: string;
  orderRequest: CreateOrderRequest;
  accessToken: string;
  paymentMethod: PaymentMethod;
}

interface UsePaymentResult {
  state: PaymentState;
  orderId: string | null;
  error: string | null;
  requestPayment: () => Promise<void>;
}

export function usePayment({
  storeId,
  orderRequest,
  accessToken,
  paymentMethod,
}: UsePaymentOptions): UsePaymentResult {
  const [state, setState] = useState<PaymentState>('idle');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paymentAttemptId = useRef<string | null>(null);

  async function requestPayment() {
    if (state !== 'idle' && state !== 'error') return;
    setState('creating');
    setError(null);
    paymentAttemptId.current ??= crypto.randomUUID();

    try {
      // 1. 주문 생성 → portonePaymentParams 수신
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ...orderRequest,
          clientOrderRequestId: paymentAttemptId.current,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? '주문 생성 실패');
      }
      const { orderId: createdOrderId, portonePaymentParams } = await res.json();
      setOrderId(createdOrderId);

      // 2. Portone v2 SDK 결제창 오픈 (dynamic import — 브라우저 전용)
      setState('paying');
      const PortOne = await import('@portone/browser-sdk/v2');

      const channelKey =
        paymentMethod === 'naverpay'
          ? process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY!
          : process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY!;

      const easyPayProvider = paymentMethod === 'naverpay' ? 'NAVERPAY' : 'KAKAOPAY';

      const response = await PortOne.requestPayment({
        storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID!,
        paymentId: createdOrderId,
        orderName: portonePaymentParams.name,
        totalAmount: portonePaymentParams.amount,
        currency: 'KRW' as const,
        channelKey,
        payMethod: 'EASY_PAY',
        easyPay: { easyPayProvider },
      });

      // code 필드가 있으면 취소 또는 오류 (v2 SDK 에러 구조)
      if (response && 'code' in response) {
        throw new Error(response.message ?? '결제가 취소되었습니다.');
      }

      // 3. 결제창 닫힘 → Firestore 리스너가 webhook 이후 상태 전환 감지
      setState('done');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '오류가 발생했습니다.';
      setError(message);
      setState('error');
    }
  }

  return { state, orderId, error, requestPayment };
}
