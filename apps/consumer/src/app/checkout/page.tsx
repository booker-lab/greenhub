'use client';

import type {
  CreateOrderRequest,
  DeliveryAddress,
  DeliveryMethod,
  Product,
  SaleType,
} from '@greenhub/shared';
import { Container, Text } from '@mantine/core';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { useSession } from 'next-auth/react';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { CartItem } from '@/hooks/useCart';
import { type PaymentMethod, usePayment } from '@/hooks/usePayment';
import CheckoutForm from './_components/CheckoutForm';

declare global {
  interface Window {
    daum: {
      Postcode: new (options: {
        oncomplete: (data: { address: string; zonecode: string }) => void;
      }) => { open: () => void };
    };
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const PHONE_PATTERN = /^[0-9+\-\s()]{8,20}$/;

// ── 단일 상품 결제 (상품 상세 → 바로 결제) ──────────────────────────────
function SingleCheckoutContent() {
  const { data: session } = useSession();
  const params = useSearchParams();
  const router = useRouter();

  const productId = params.get('productId') ?? '';
  const quantity = Number(params.get('quantity') ?? 1);
  const saleType = (params.get('saleType') ?? 'normal') as SaleType;
  const deliveryMethod = (params.get('deliveryMethod') ?? 'direct') as DeliveryMethod;
  const totalAmount = Number(params.get('totalAmount') ?? 0);
  const requestedDeliveryDate = params.get('requestedDeliveryDate') ?? undefined;

  const [product, setProduct] = useState<Product | null>(null);

  useEffect(() => {
    if (!productId) return;
    fetch(`${API_URL}/products/${productId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setProduct(data as Product);
      })
      .catch(() => {});
  }, [productId]);

  const [address, setAddress] = useState<DeliveryAddress>({
    address: '',
    addressDetail: '',
    zipCode: '',
  });
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kakaopay');

  const orderRequest: CreateOrderRequest = {
    productId,
    quantity,
    saleType,
    deliveryMethod,
    deliveryAddress: address,
    deliveryPhone: deliveryPhone.trim(),
    ...(requestedDeliveryDate ? { requestedDeliveryDate } : {}),
    ...(saleType === 'group' && {
      groupBuyConsent: { agreed: true, agreedAt: new Date().toISOString() },
    }),
  };

  const { state, orderId, error, requestPayment } = usePayment({
    storeId: product?.storeId ?? '',
    orderRequest,
    accessToken: session?.user?.accessToken ?? '',
    paymentMethod,
  });

  if (state === 'done' && orderId) {
    router.replace(`/order/success?orderId=${orderId}`);
    return null;
  }

  const isLoading = state === 'creating' || state === 'paying';
  const canPay =
    !isLoading &&
    !!address.address &&
    !!address.zipCode &&
    PHONE_PATTERN.test(deliveryPhone.trim()) &&
    !!session;

  return (
    <CheckoutForm
      items={[]}
      totalAmount={totalAmount}
      address={address}
      onAddressChange={setAddress}
      deliveryPhone={deliveryPhone}
      onDeliveryPhoneChange={setDeliveryPhone}
      paymentMethod={paymentMethod}
      onPaymentMethodChange={setPaymentMethod}
      isLoading={isLoading}
      canPay={canPay}
      error={error}
      onPay={requestPayment}
      singleSummary={{ quantity, deliveryMethod, requestedDeliveryDate }}
    />
  );
}

// ── 장바구니 다중 결제 ────────────────────────────────────────────────────
function CartCheckoutContent() {
  const { data: session } = useSession();
  const router = useRouter();

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [address, setAddress] = useState<DeliveryAddress>({
    address: '',
    addressDetail: '',
    zipCode: '',
  });
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kakaopay');
  const [state, setState] = useState<'idle' | 'creating' | 'paying' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const paymentAttemptIds = useRef(new Map<string, string>());

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('checkout_cart');
      if (raw) setCartItems(JSON.parse(raw) as CartItem[]);
    } catch {}
  }, []);

  const totalAmount = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const isLoading = state === 'creating' || state === 'paying';
  const canPay =
    !isLoading &&
    !!address.address &&
    !!address.zipCode &&
    PHONE_PATTERN.test(deliveryPhone.trim()) &&
    !!session &&
    cartItems.length > 0;

  async function handlePay() {
    if (state !== 'idle' && state !== 'error') return;
    setError(null);

    const accessToken = session?.user?.accessToken ?? '';
    const channelKey =
      paymentMethod === 'naverpay'
        ? process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY!
        : process.env.NEXT_PUBLIC_PORTONE_KAKAOPAY_CHANNEL_KEY!;
    const easyPayProvider = paymentMethod === 'naverpay' ? 'NAVERPAY' : 'KAKAOPAY';
    const PortOne = await import('@portone/browser-sdk/v2');

    let lastOrderId: string | null = null;

    for (const item of cartItems) {
      const itemKey = [
        item.storeId,
        item.productId,
        item.saleType,
        item.deliveryMethod,
        item.requestedDeliveryDate ?? '',
      ].join(':');
      const clientOrderRequestId =
        paymentAttemptIds.current.get(itemKey) ?? crypto.randomUUID();
      paymentAttemptIds.current.set(itemKey, clientOrderRequestId);
      setState('creating');
      const res = await fetch(`${API_URL}/stores/${item.storeId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          clientOrderRequestId,
          productId: item.productId,
          quantity: item.quantity,
          saleType: item.saleType,
          deliveryMethod: item.deliveryMethod,
          deliveryAddress: address,
          deliveryPhone: deliveryPhone.trim(),
          ...(item.requestedDeliveryDate
            ? { requestedDeliveryDate: item.requestedDeliveryDate }
            : {}),
          ...(item.saleType === 'group' && {
            groupBuyConsent: { agreed: true, agreedAt: new Date().toISOString() },
          }),
        } satisfies CreateOrderRequest & { clientOrderRequestId: string }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? '주문 생성 실패');
        setState('error');
        return;
      }
      const { orderId, portonePaymentParams } = await res.json();
      lastOrderId = orderId;

      setState('paying');
      const response = await PortOne.requestPayment({
        storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID!,
        paymentId: orderId,
        orderName: portonePaymentParams.name,
        totalAmount: portonePaymentParams.amount,
        currency: 'KRW' as const,
        channelKey,
        payMethod: 'EASY_PAY',
        easyPay: { easyPayProvider },
      });
      if (response && 'code' in response) {
        setError(response.message ?? '결제가 취소되었습니다.');
        setState('error');
        return;
      }
      setState('idle');
    }

    sessionStorage.removeItem('checkout_cart');
    setState('done');
    if (lastOrderId) router.replace(`/order/success?orderId=${lastOrderId}`);
  }

  return (
    <CheckoutForm
      items={cartItems}
      totalAmount={totalAmount}
      address={address}
      onAddressChange={setAddress}
      deliveryPhone={deliveryPhone}
      onDeliveryPhoneChange={setDeliveryPhone}
      paymentMethod={paymentMethod}
      onPaymentMethodChange={setPaymentMethod}
      isLoading={isLoading}
      canPay={canPay}
      error={error}
      onPay={handlePay}
    />
  );
}

// ── 진입점 ───────────────────────────────────────────────────────────────
function CheckoutContent() {
  const params = useSearchParams();
  const fromCart = params.get('from') === 'cart';
  return fromCart ? <CartCheckoutContent /> : <SingleCheckoutContent />;
}

export default function CheckoutPage() {
  return (
    <>
      <Script
        src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"
        strategy="lazyOnload"
      />
      <Suspense
        fallback={
          <Container size="sm" px="md" py="lg">
            <Text>로딩 중...</Text>
          </Container>
        }
      >
        <CheckoutContent />
      </Suspense>
    </>
  );
}
