'use client';

import type {
  CreateOrderRequest,
  DeliveryAddress,
  DeliveryMethod,
  OrderAcquisitionSnapshot,
  Product,
  SaleType,
} from '@greenhub/shared';
import { Container, Text } from '@mantine/core';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { useSession } from 'next-auth/react';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  type CartItem,
  isRoundCartItem,
  parseCartSnapshot,
  type RoundCartItem,
} from '@/hooks/useCart';
import { type PaymentMethod, usePayment } from '@/hooks/usePayment';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { getAcquisitionSnapshot } from '@/lib/acquisition';
import { getApiBaseUrl } from '@/lib/api-base-url';
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

const API_URL = getApiBaseUrl();
const PHONE_PATTERN = /^[0-9+\-\s()]{8,20}$/;

type CheckoutCart =
  | { kind: 'invalid'; items: [] }
  | { kind: 'legacy'; items: CartItem[] }
  | { kind: 'round'; items: RoundCartItem[] };

type LoadedCheckoutCart = CheckoutCart | { kind: 'loading'; items: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRoundMetadata(value: unknown) {
  return isRecord(value) && ('roundId' in value || 'roundItemId' in value || 'roundPrice' in value);
}

function parseCheckoutCart(raw: string | null): CheckoutCart {
  if (!raw) return { kind: 'invalid', items: [] };

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', items: [] };
  }
  if (!Array.isArray(stored) || stored.length === 0) {
    return { kind: 'invalid', items: [] };
  }

  const items = parseCartSnapshot(raw);
  if (items.length !== stored.length) {
    return { kind: 'invalid', items: [] };
  }

  if (items.every(isRoundCartItem)) {
    const firstItem = items[0];
    if (
      !firstItem ||
      items.some(
        (item) =>
          item.roundId !== firstItem.roundId ||
          item.storeId !== firstItem.storeId ||
          item.saleType !== 'normal' ||
          item.deliveryMethod !== 'direct',
      ) ||
      new Set(items.map((item) => item.roundItemId)).size !== items.length
    ) {
      return { kind: 'invalid', items: [] };
    }
    return { kind: 'round', items };
  }

  if (items.some(isRoundCartItem) || stored.some(hasRoundMetadata)) {
    return { kind: 'invalid', items: [] };
  }
  return { kind: 'legacy', items };
}

function dateInSeoul(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function resolveRoundCheckoutSchedule(
  items: RoundCartItem[],
  rounds: PublicSaleRound[],
): { round: PublicSaleRound; requestedDeliveryDate: string } | null {
  const firstItem = items[0];
  if (
    !firstItem ||
    items.some(
      (item) =>
        item.roundId !== firstItem.roundId ||
        item.storeId !== firstItem.storeId ||
        item.saleType !== 'normal' ||
        item.deliveryMethod !== 'direct',
    )
  ) {
    return null;
  }

  const round = rounds.find(
    (candidate) => candidate.id === firstItem.roundId && candidate.storeId === firstItem.storeId,
  );
  if (!round || round.schedule.timezone !== 'Asia/Seoul') return null;

  const deliveryStart = new Date(round.schedule.deliveryStartAt);
  const deliveryEnd = new Date(round.schedule.deliveryEndAt);
  const requestedDeliveryDate = dateInSeoul(round.schedule.deliveryStartAt);
  if (
    !Number.isFinite(deliveryStart.getTime()) ||
    !Number.isFinite(deliveryEnd.getTime()) ||
    deliveryStart.getTime() >= deliveryEnd.getTime() ||
    !requestedDeliveryDate ||
    dateInSeoul(round.schedule.deliveryEndAt) !== requestedDeliveryDate
  ) {
    return null;
  }

  const matchesRoundItems = items.every((item) =>
    round.items.some(
      (roundItem) =>
        roundItem.id === item.roundItemId &&
        roundItem.roundId === item.roundId &&
        roundItem.storeId === item.storeId &&
        roundItem.productId === item.productId &&
        roundItem.roundPrice === item.roundPrice,
    ),
  );
  return matchesRoundItems ? { round, requestedDeliveryDate } : null;
}
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
function LegacyCartCheckoutContent({ cartItems }: { cartItems: CartItem[] }) {
  const { data: session } = useSession();
  const router = useRouter();

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
      const clientOrderRequestId = paymentAttemptIds.current.get(itemKey) ?? crypto.randomUUID();
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
function RoundCartCheckoutContent({ cartItems }: { cartItems: RoundCartItem[] }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [address, setAddress] = useState<DeliveryAddress>({
    address: '',
    addressDetail: '',
    zipCode: '',
  });
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kakaopay');
  const [marketingAgreedAt, setMarketingAgreedAt] = useState<string | null>(null);
  const [acquisition, setAcquisition] = useState<OrderAcquisitionSnapshot | null>(null);
  const storeId = cartItems[0]?.storeId ?? '';
  const saleRounds = useSaleRounds(storeId || null);
  const schedule = resolveRoundCheckoutSchedule(cartItems, saleRounds.rounds);

  useEffect(() => {
    setAcquisition(getAcquisitionSnapshot());
  }, []);

  const { state, orderId, error, requestPayment } = usePayment({
    storeId,
    orderRequest: {
      deliveryAddress: address,
      deliveryPhone: deliveryPhone.trim(),
      ...(schedule ? { requestedDeliveryDate: schedule.requestedDeliveryDate } : {}),
      ...(marketingAgreedAt
        ? {
            marketingConsent: {
              agreed: true,
              channels: ['alimtalk', 'sms'],
              copyVersion: 'round-direct-checkout-v1',
              agreedAt: marketingAgreedAt,
            },
          }
        : {}),
      ...(acquisition ? { acquisition } : {}),
    },
    roundItems: cartItems,
    accessToken: session?.user?.accessToken ?? '',
    paymentMethod,
  });

  useEffect(() => {
    if (state !== 'done' || !orderId) return;
    sessionStorage.removeItem('checkout_cart');
    router.replace(`/order/success?orderId=${orderId}`);
  }, [orderId, router, state]);

  const totalAmount = cartItems.reduce((sum, item) => sum + item.roundPrice * item.quantity, 0);
  const isLoading = state === 'creating' || state === 'paying';
  const scheduleError =
    saleRounds.status === 'error'
      ? saleRounds.error
      : (saleRounds.status === 'success' || saleRounds.status === 'empty') && !schedule
        ? '상품·가격·회차 정보가 변경되어 결제할 수 없습니다. 장바구니에서 변경 내용을 다시 확인해 주세요.'
        : null;
  const canPay =
    !isLoading &&
    !!schedule &&
    !!address.address &&
    !!address.zipCode &&
    PHONE_PATTERN.test(deliveryPhone.trim()) &&
    !!session;

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
      error={scheduleError ?? error}
      onPay={requestPayment}
      marketingConsent={marketingAgreedAt !== null}
      onMarketingConsentChange={(agreed) =>
        setMarketingAgreedAt(agreed ? new Date().toISOString() : null)
      }
    />
  );
}

function CartCheckoutContent() {
  const [cart, setCart] = useState<LoadedCheckoutCart>({ kind: 'loading', items: [] });

  useEffect(() => {
    try {
      setCart(parseCheckoutCart(sessionStorage.getItem('checkout_cart')));
    } catch {
      setCart({ kind: 'invalid', items: [] });
    }
  }, []);

  if (cart.kind === 'loading') {
    return (
      <Container size="sm" px="md" py="lg">
        <Text>결제 상품을 확인하는 중...</Text>
      </Container>
    );
  }
  if (cart.kind === 'invalid') {
    return (
      <Container size="sm" px="md" py="lg">
        <Text c="red">결제할 장바구니 정보를 확인할 수 없습니다.</Text>
      </Container>
    );
  }
  return cart.kind === 'round' ? (
    <RoundCartCheckoutContent cartItems={cart.items} />
  ) : (
    <LegacyCartCheckoutContent cartItems={cart.items} />
  );
}
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
