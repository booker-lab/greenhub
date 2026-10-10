'use client';

import type {
  CreateOrderRequest,
  DeliveryAddress,
  DeliveryMethod,
  OrderAcquisitionSnapshot,
  Product,
  SaleType,
} from '@greenhub/shared';
import { Box, Button, Container, Text } from '@mantine/core';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { useSession } from 'next-auth/react';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  type CartItem,
  isRoundCartItem,
  parseCartSnapshot,
  type RoundCartItem,
  useCart,
} from '@/hooks/useCart';
import { type PaymentMethod, usePayment } from '@/hooks/usePayment';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { getAcquisitionSnapshot } from '@/lib/acquisition';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { getCartValidationError } from '@/lib/cartValidation';
import { pickCheckoutPrefill, prefillAddress, prefillPhone } from '@/lib/checkout-prefill';
import {
  buildPaymentRedirectUrl,
  createPendingOrderPayment,
  ORDER_PAYMENT_REDIRECT_PATH,
  readBrowserPaymentContext,
  savePendingOrderPayment,
} from '@/lib/payment-redirect';
import { readPortonePaymentConfiguration } from '@/lib/portone-config';
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

/**
 * 단건 결제 화면의 표시 금액. URL 쿼리의 금액 값은 받지 않고 서버가 돌려준 상품 가격과
 * 주문 요청에 그대로 쓰는 수량으로만 계산한다. 실제 청구 금액은 주문 생성 응답이 정하고
 * 결제창도 그 값만 쓴다. null은 서버 상품을 확인하는 중, 0은 표시할 금액이 없음을 뜻한다.
 */
function resolveSingleCheckoutAmount(
  product: Pick<Product, 'price'> | null,
  quantity: number,
  productUnavailable: boolean,
): number | null {
  if (productUnavailable) return 0;
  if (!product) return null;
  const { price } = product;
  if (
    !Number.isSafeInteger(price) ||
    price < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0
  ) {
    return 0;
  }
  const amount = price * quantity;
  return Number.isSafeInteger(amount) ? amount : 0;
}

function SingleCheckoutContent() {
  const { data: session } = useSession();
  const params = useSearchParams();
  const router = useRouter();

  const productId = params.get('productId') ?? '';
  const quantity = Number(params.get('quantity') ?? 1);
  const saleType = (params.get('saleType') ?? 'normal') as SaleType;
  const deliveryMethod = (params.get('deliveryMethod') ?? 'direct') as DeliveryMethod;
  const requestedDeliveryDate = params.get('requestedDeliveryDate') ?? undefined;

  const [product, setProduct] = useState<Product | null>(null);
  const [productLoadFailed, setProductLoadFailed] = useState(false);

  useEffect(() => {
    if (!productId) return;
    fetch(`${API_URL}/products/${encodeURIComponent(productId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setProduct(data as Product);
        else setProductLoadFailed(true);
      })
      .catch(() => setProductLoadFailed(true));
  }, [productId]);

  const productUnavailable = !productId || productLoadFailed;
  const totalAmount = resolveSingleCheckoutAmount(product, quantity, productUnavailable);

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
      error={
        error ??
        (productUnavailable ? '상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : null)
      }
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
  const cartValidationError = getCartValidationError(cartItems);
  const isLoading = state === 'creating' || state === 'paying';
  const canPay =
    !cartValidationError &&
    !isLoading &&
    !!address.address &&
    !!address.zipCode &&
    PHONE_PATTERN.test(deliveryPhone.trim()) &&
    !!session &&
    cartItems.length > 0;

  async function handlePay() {
    if (state !== 'idle' && state !== 'error') return;
    if (cartValidationError) {
      setError(cartValidationError);
      setState('error');
      return;
    }
    setError(null);

    const accessToken = session?.user?.accessToken ?? '';
    let configuration: ReturnType<typeof readPortonePaymentConfiguration>;
    try {
      configuration = readPortonePaymentConfiguration(paymentMethod);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '결제 설정을 확인할 수 없습니다.');
      setState('error');
      return;
    }
    const PortOne = await import('@portone/browser-sdk/v2');
    // 모바일은 같은 탭 리다이렉트로 결과가 오므로 첫 결제 뒤 이 반복문은 이어지지 않는다.
    // 복귀 화면이 남은 미결제 상품 수를 안내할 수 있게 결제 전 기록에 남긴다.
    const browser = readBrowserPaymentContext();
    const redirectUrl = browser
      ? buildPaymentRedirectUrl(browser.origin, ORDER_PAYMENT_REDIRECT_PATH)
      : null;

    let lastOrderId: string | null = null;

    for (const [index, item] of cartItems.entries()) {
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
      savePendingOrderPayment(
        browser?.storage ?? null,
        createPendingOrderPayment({
          paymentId: orderId,
          clearCheckoutCart: true,
          unpaidItemCount: cartItems.length - index - 1,
          // 앞 상품이 이미 결제됐다면 같은 장바구니로 다시 결제하면 중복 주문이 되므로 첫 상품만 재시도 경로를 둔다.
          retryPath: index === 0 ? (browser?.currentPath ?? null) : null,
          now: Date.now(),
        }),
      );
      let response: Awaited<ReturnType<typeof PortOne.requestPayment>>;
      try {
        response = await PortOne.requestPayment({
          storeId: configuration.portoneStoreId,
          paymentId: orderId,
          orderName: portonePaymentParams.name,
          totalAmount: portonePaymentParams.amount,
          currency: 'KRW' as const,
          channelKey: configuration.channelKey,
          payMethod: 'EASY_PAY',
          easyPay: { easyPayProvider: configuration.easyPayProvider },
          ...(redirectUrl ? { redirectUrl } : {}),
        });
      } finally {
        savePendingOrderPayment(browser?.storage ?? null, null);
      }
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
      error={cartValidationError ?? error}
      onPay={handlePay}
    />
  );
}
function RoundCartCheckoutContent({ cartItems }: { cartItems: RoundCartItem[] }) {
  const { data: session } = useSession();
  const router = useRouter();
  const { removeRoundItems } = useCart();
  const [address, setAddress] = useState<DeliveryAddress>({
    address: '',
    addressDetail: '',
    zipCode: '',
  });
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kakaopay');
  const [acquisition, setAcquisition] = useState<OrderAcquisitionSnapshot | null>(null);
  const storeId = cartItems[0]?.storeId ?? '';
  const saleRounds = useSaleRounds(storeId || null);
  const schedule = resolveRoundCheckoutSchedule(cartItems, saleRounds.rounds);

  useEffect(() => {
    setAcquisition(getAcquisitionSnapshot());
  }, []);

  // 계정에 저장된 기본 배송지·전화번호로 빈 칸만 채운다(결제 실패 뒤 다시 들어와도 그대로).
  const accessToken = session?.user?.accessToken;
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((profile) => {
        if (cancelled || !profile) return;
        const prefill = pickCheckoutPrefill(profile);
        setAddress((current) => prefillAddress(current, prefill));
        setDeliveryPhone((current) => prefillPhone(current, prefill));
      })
      .catch(() => {
        // 자동 채움은 편의 기능이라 실패해도 직접 입력으로 진행한다.
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const { state, orderId, error, requestPayment } = usePayment({
    storeId,
    orderRequest: {
      deliveryAddress: address,
      deliveryPhone: deliveryPhone.trim(),
      ...(requestNote.trim() ? { requestNote: requestNote.trim() } : {}),
      ...(schedule ? { requestedDeliveryDate: schedule.requestedDeliveryDate } : {}),
      ...(acquisition ? { acquisition } : {}),
    },
    roundItems: cartItems,
    accessToken: session?.user?.accessToken ?? '',
    paymentMethod,
  });

  useEffect(() => {
    if (state !== 'done' || !orderId) return;
    sessionStorage.removeItem('checkout_cart');
    try {
      // 바로 구매로 들어온 경우 장바구니의 다른 상품은 남겨야 하므로 결제한 회차 상품만 뺀다.
      removeRoundItems(cartItems.map((item) => item.roundItemId));
    } catch {
      // 저장소 접근이 막혀도 결제 완료 화면 이동은 막지 않는다.
    }
    router.replace(`/order/success?orderId=${orderId}`);
  }, [cartItems, orderId, removeRoundItems, router, state]);

  const totalAmount = cartItems.reduce((sum, item) => sum + item.roundPrice * item.quantity, 0);
  const isLoading = state === 'creating' || state === 'paying';
  const scheduleError =
    saleRounds.status === 'error'
      ? saleRounds.error
      : saleRounds.status === 'stale'
        ? `최신 회차 정보를 불러오지 못했습니다. 이전 결과로는 결제할 수 없습니다. 다시 시도 후 결제해 주세요.${saleRounds.error ? ` (${saleRounds.error})` : ''}`
        : (saleRounds.status === 'success' ||
              saleRounds.status === 'empty' ||
              saleRounds.status === 'refreshing') &&
            !schedule
          ? '상품·가격·회차 정보가 변경되어 결제할 수 없습니다. 장바구니에서 변경 내용을 다시 확인해 주세요.'
          : null;
  const canPay =
    !isLoading &&
    !!schedule &&
    !saleRounds.isStale &&
    !!address.address &&
    !!address.zipCode &&
    PHONE_PATTERN.test(deliveryPhone.trim()) &&
    !!session;

  return (
    <>
      {saleRounds.isRefreshing && (
        <Container size="sm" px="md" pt="sm">
          <Text size="sm" c="dimmed" ta="center" aria-live="polite">
            최신 회차 정보를 확인하는 중...
          </Text>
        </Container>
      )}
      {saleRounds.isStale && (
        <Container size="sm" px="md" pt="sm">
          <Box
            p="sm"
            role="alert"
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
            }}
          >
            <Text size="sm">최신 회차 정보를 불러오지 못했습니다. 이전 결과로는 결제할 수 없습니다.</Text>
            {saleRounds.error && (
              <Text size="sm" c="dimmed" mt={4}>
                {saleRounds.error}
              </Text>
            )}
            <Button variant="light" size="xs" mt="xs" onClick={saleRounds.refetch}>
              다시 시도
            </Button>
          </Box>
        </Container>
      )}
      <CheckoutForm
      items={cartItems}
      totalAmount={totalAmount}
      address={address}
      onAddressChange={setAddress}
      deliveryPhone={deliveryPhone}
      onDeliveryPhoneChange={setDeliveryPhone}
      requestNote={requestNote}
      onRequestNoteChange={setRequestNote}
      paymentMethod={paymentMethod}
      onPaymentMethodChange={setPaymentMethod}
      isLoading={isLoading}
      canPay={canPay}
      error={scheduleError ?? error}
      onPay={requestPayment}
    />
    </>
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
