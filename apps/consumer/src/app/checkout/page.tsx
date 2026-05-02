'use client';

import { Suspense, useState, useEffect } from 'react';
import Script from 'next/script';
import { useSession } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Container,
  Title,
  Text,
  Paper,
  Stack,
  TextInput,
  Group,
  Button,
  Alert,
} from '@mantine/core';
import { usePayment, type PaymentMethod } from '@/hooks/usePayment';
import type {
  CreateOrderRequest,
  DeliveryAddress,
  DeliveryMethod,
  SaleType,
  Product,
} from '@greenhub/shared';
import type { CartItem } from '@/hooks/useCart';

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
const NAVERPAY_ENABLED = !!process.env.NEXT_PUBLIC_PORTONE_NAVERPAY_CHANNEL_KEY;

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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kakaopay');

  const orderRequest: CreateOrderRequest = {
    productId,
    quantity,
    saleType,
    deliveryMethod,
    deliveryAddress: address,
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
  const canPay = !isLoading && !!address.address && !!address.zipCode && !!session;

  return (
    <CheckoutForm
      items={[]}
      totalAmount={totalAmount}
      address={address}
      onAddressChange={setAddress}
      paymentMethod={paymentMethod}
      onPaymentMethodChange={setPaymentMethod}
      isLoading={isLoading}
      canPay={canPay}
      error={error}
      onPay={requestPayment}
      singleSummary={{ quantity, deliveryMethod }}
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kakaopay');
  const [state, setState] = useState<'idle' | 'creating' | 'paying' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('checkout_cart');
      if (raw) setCartItems(JSON.parse(raw) as CartItem[]);
    } catch {}
  }, []);

  const totalAmount = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const isLoading = state === 'creating' || state === 'paying';
  const canPay =
    !isLoading && !!address.address && !!address.zipCode && !!session && cartItems.length > 0;

  async function handlePay() {
    if (state !== 'idle') return;
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
      setState('creating');
      const res = await fetch(`${API_URL}/stores/${item.storeId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          productId: item.productId,
          quantity: item.quantity,
          saleType: item.saleType,
          deliveryMethod: item.deliveryMethod,
          deliveryAddress: address,
          ...(item.saleType === 'group' && {
            groupBuyConsent: { agreed: true, agreedAt: new Date().toISOString() },
          }),
        } satisfies CreateOrderRequest),
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
      paymentMethod={paymentMethod}
      onPaymentMethodChange={setPaymentMethod}
      isLoading={isLoading}
      canPay={canPay}
      error={error}
      onPay={handlePay}
    />
  );
}

// ── 공통 UI ──────────────────────────────────────────────────────────────
interface CheckoutFormProps {
  items: CartItem[];
  totalAmount: number;
  address: DeliveryAddress;
  onAddressChange: (a: DeliveryAddress) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (m: PaymentMethod) => void;
  isLoading: boolean;
  canPay: boolean;
  error: string | null;
  onPay: () => void;
  singleSummary?: { quantity: number; deliveryMethod: DeliveryMethod };
}

const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

const PAYMENT_OPTIONS: { method: PaymentMethod; label: string; icon: string }[] = [
  { method: 'kakaopay', label: '카카오페이', icon: '💛' },
  ...(NAVERPAY_ENABLED
    ? [{ method: 'naverpay' as PaymentMethod, label: '네이버페이', icon: '🟢' }]
    : []),
];

function CheckoutForm({
  items,
  totalAmount,
  address,
  onAddressChange,
  paymentMethod,
  onPaymentMethodChange,
  isLoading,
  canPay,
  error,
  onPay,
  singleSummary,
}: CheckoutFormProps) {
  useEffect(() => {
    if (!isLoading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isLoading]);

  function openAddressSearch() {
    new window.daum.Postcode({
      oncomplete(data) {
        onAddressChange({
          ...address,
          address: data.address,
          zipCode: data.zonecode,
          addressDetail: '',
        });
      },
    }).open();
  }

  const buttonLabel = isLoading
    ? '처리 중...'
    : paymentMethod === 'naverpay'
      ? '네이버페이로 결제하기'
      : '카카오페이로 결제하기';

  return (
    <Container size="sm" px="md" py="lg">
      <Title order={2} mb="lg">
        결제
      </Title>

      {/* 주문 요약 */}
      <Paper radius="md" p="md" mb="lg" style={{ background: 'var(--color-surface-muted)' }}>
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }} mb="xs">
          주문 정보
        </Text>
        <Stack gap={4}>
          {items.length > 0
            ? items.map((item) => (
                <Group key={item.productId} justify="space-between">
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                      flex: 1,
                    }}
                  >
                    {item.name} × {item.quantity}
                  </Text>
                  <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                    {(item.price * item.quantity).toLocaleString()}원
                  </Text>
                </Group>
              ))
            : singleSummary && (
                <Group justify="space-between">
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    수량
                  </Text>
                  <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                    {singleSummary.quantity}개
                  </Text>
                </Group>
              )}
          {singleSummary && (
            <Group justify="space-between">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                배송 방법
              </Text>
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                {DELIVERY_LABELS[singleSummary.deliveryMethod]}
              </Text>
            </Group>
          )}
          {totalAmount > 0 && (
            <Group justify="space-between" mt={4}>
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
                결제 금액
              </Text>
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}>
                {totalAmount.toLocaleString()}원
              </Text>
            </Group>
          )}
        </Stack>
      </Paper>

      {/* 배송지 */}
      <Stack gap="sm" mb="lg">
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}>
          배송지
        </Text>
        <Group gap="xs" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            placeholder="주소 검색 후 자동 입력 *"
            value={address.address}
            readOnly
            radius="md"
          />
          <Button variant="outline" color="gray" radius="md" onClick={openAddressSearch}>
            주소 검색
          </Button>
        </Group>
        <TextInput
          placeholder="상세 주소"
          value={address.addressDetail}
          onChange={(e) => onAddressChange({ ...address, addressDetail: e.target.value })}
          radius="md"
        />
        <TextInput
          placeholder="우편번호 (자동 입력)"
          value={address.zipCode}
          readOnly
          radius="md"
        />
      </Stack>

      {/* 결제 수단 */}
      <Stack gap="xs" mb="lg">
        <Text style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}>
          결제 수단
        </Text>
        {PAYMENT_OPTIONS.map(({ method, label, icon }) => {
          const isSelected = paymentMethod === method;
          return (
            <Paper
              key={method}
              p="sm"
              radius="md"
              onClick={() => onPaymentMethodChange(method)}
              style={{
                border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <span>{icon}</span>
              <Text
                style={{
                  fontWeight: isSelected ? 'var(--fw-bold)' : 'var(--fw-medium)',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                {label}
              </Text>
            </Paper>
          );
        })}
      </Stack>

      {error && (
        <Alert color="red" variant="light" mb="sm">
          <Text style={{ fontSize: 'var(--font-size-sm)' }}>{error}</Text>
        </Alert>
      )}

      <Button
        fullWidth
        size="lg"
        color="brand"
        radius="md"
        disabled={!canPay}
        loading={isLoading}
        onClick={onPay}
      >
        {buttonLabel}
      </Button>
    </Container>
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
