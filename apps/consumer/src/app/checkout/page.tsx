'use client';

import type {
  CreateOrderRequest,
  DeliveryAddress,
  DeliveryMethod,
  OrderAcquisitionSnapshot,
  Product,
  SaleType,
} from '@greenhub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { useSession } from 'next-auth/react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { EMPTY_GIFT, type GiftState, giftPayload } from '@/components/benchmark/GiftFields';
import {
  EMPTY_PACKAGE_LABEL,
  type PackageLabelState,
  packageLabelPayload,
} from '@/components/benchmark/PackageLabelFields';
import {
  type CartItem,
  isRoundCartItem,
  parseCartSnapshot,
  type RoundCartItem,
  useCart,
} from '@/hooks/useCart';
import { type PaymentMethod, usePayment } from '@/hooks/usePayment';
import {
  type PublicSaleRound,
  type SaleRoundsRequestStatus,
  useSaleRounds,
} from '@/hooks/useSaleRounds';
import { getAcquisitionSnapshot } from '@/lib/acquisition';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { getCartValidationError } from '@/lib/cartValidation';
import {
  CHECKOUT_HOLD_LIMIT_ORDERS_LABEL,
  CHECKOUT_HOLD_LIMIT_ORDERS_PATH,
} from '@/lib/checkout-hold-limit';
import {
  CHECKOUT_PAYMENT_UNAVAILABLE_MESSAGE,
  ORDER_CREATE_FAILED_MESSAGE,
} from '@/lib/checkout-messages';
import { pickCheckoutPrefill, prefillAddress, prefillPhone } from '@/lib/checkout-prefill';
import {
  isCheckoutRoundClosed,
  msUntilRoundOrderClose,
  ROUND_ORDER_CLOSED_MESSAGE,
} from '@/lib/checkout-round-closed';
import { isFeatureOn } from '@/lib/features';
import { isKoreanMobilePhone, ROUND_DELIVERY_PHONE_ERROR } from '@/lib/korean-mobile-phone';
import { CONNECTION_UNSTABLE_MESSAGE } from '@/lib/load-error-message';
import {
  checkoutDraftCartKey,
  clearCheckoutDraft,
  loadCheckoutDraft,
  readCheckoutDraftStorage,
  saveCheckoutDraft,
} from '@/lib/payment-checkout-draft';
import {
  failedPaymentNotice,
  type PaymentFailureNotice,
  paymentFailureNotice,
} from '@/lib/payment-failure-message';
import { attachPaymentPageGuard, type PaymentPagePhase } from '@/lib/payment-page-guard';
import {
  buildPaymentRedirectUrl,
  clearOwnPendingOrderPayment,
  createPendingOrderPayment,
  ORDER_PAYMENT_REDIRECT_PATH,
  readBrowserPaymentContext,
  savePendingOrderPayment,
} from '@/lib/payment-redirect';
import {
  buildPortonePayMethodRequest,
  readPortonePaymentConfiguration,
} from '@/lib/portone-config';
import { formatRoundTime } from '@/lib/round-schedule-label';
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
const EMPTY_DELIVERY_ADDRESS: DeliveryAddress = { address: '', addressDetail: '', zipCode: '' };

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

const ROUND_STALE_PAY_MESSAGE =
  '최신 회차 정보를 불러오지 못해 지금은 결제할 수 없어요. 다시 시도한 뒤 결제해 주세요.';
const ROUND_CHANGED_PAY_MESSAGE =
  '상품·가격·회차 정보가 바뀌어 결제할 수 없어요. 장바구니에서 바뀐 내용을 다시 확인해 주세요.';

/**
 * 회차 결제 버튼 옆에 보일 회차 확인 안내. 같은 뜻을 괄호로 덧붙이지 않고 한 문장으로만 안내한다.
 * - error: 회차 조회 실패 안내(이미 고객 문구)를 그대로 쓴다.
 * - stale: 이전 결과로는 결제하지 않으므로 다시 시도를 안내한다.
 * - 조회는 됐지만 장바구니와 맞는 회차가 없으면 바뀐 내용을 확인하게 한다.
 */
function resolveRoundScheduleError(
  status: SaleRoundsRequestStatus,
  error: string | null,
  hasSchedule: boolean,
): string | null {
  if (status === 'error') return error;
  if (status === 'stale') return ROUND_STALE_PAY_MESSAGE;
  if ((status === 'success' || status === 'empty' || status === 'refreshing') && !hasSchedule) {
    return ROUND_CHANGED_PAY_MESSAGE;
  }
  return null;
}

/**
 * 오래된 회차 정보 안내 아래에 덧붙일 원인. "판매 회차를 불러오지 못했어요"처럼 위 안내와 뜻이 같으면
 * 보이지 않고, 연결이 불안정한 경우처럼 고객이 할 일이 달라지는 원인만 보인다.
 */
function staleRoundsDetail(error: string | null): string | null {
  return error === CONNECTION_UNSTABLE_MESSAGE ? error : null;
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
    buyer: { name: session?.user?.name, phone: deliveryPhone.trim() },
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
        (productUnavailable
          ? failedPaymentNotice('상품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
          : null)
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
  const [state, setState] = useState<PaymentPagePhase>('idle');
  // 문구와 종류를 함께 둔다: 고객이 결제창을 닫은 안내(canceled)만 중립 면, 그 밖은 빨강 면으로 그린다.
  const [error, setError] = useState<PaymentFailureNotice | null>(null);
  const paymentAttemptIds = useRef(new Map<string, string>());
  // 이탈 경고·같은 탭 복귀 판단은 렌더를 기다리지 않고 이 값으로 한다(C-01).
  const phase = useRef<PaymentPagePhase>('idle');
  const attemptGeneration = useRef(0);

  function transition(next: PaymentPagePhase) {
    phase.current = next;
    setState(next);
  }

  useEffect(
    () =>
      attachPaymentPageGuard(window, {
        getPhase: () => phase.current,
        onRestore: () => {
          attemptGeneration.current += 1;
          // 새로 로드된 복귀와 같게 다음 결제는 새 결제 시도 ID로 주문한다.
          paymentAttemptIds.current.clear();
          phase.current = 'idle';
          setState('idle');
          setError(null);
        },
      }),
    [],
  );

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
    const generation = attemptGeneration.current;
    if (cartValidationError) {
      setError(failedPaymentNotice(cartValidationError));
      transition('error');
      return;
    }
    setError(null);

    const accessToken = session?.user?.accessToken ?? '';
    let configuration: ReturnType<typeof readPortonePaymentConfiguration>;
    try {
      configuration = readPortonePaymentConfiguration(paymentMethod);
    } catch {
      // 결제 설정 원문 대신 고객 문구를 보인다.
      setError(failedPaymentNotice(CHECKOUT_PAYMENT_UNAVAILABLE_MESSAGE));
      transition('error');
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
      transition('creating');
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
        setError(failedPaymentNotice(body.message ?? ORDER_CREATE_FAILED_MESSAGE));
        transition('error');
        return;
      }
      const { orderId, portonePaymentParams } = await res.json();
      lastOrderId = orderId;

      transition('paying');
      const pending = createPendingOrderPayment({
        paymentId: orderId,
        clearCheckoutCart: true,
        unpaidItemCount: cartItems.length - index - 1,
        // 앞 상품이 이미 결제됐다면 같은 장바구니로 다시 결제하면 중복 주문이 되므로 첫 상품만 재시도 경로를 둔다.
        retryPath: index === 0 ? (browser?.currentPath ?? null) : null,
        now: Date.now(),
      });
      savePendingOrderPayment(browser?.storage ?? null, pending);
      let response: Awaited<ReturnType<typeof PortOne.requestPayment>>;
      try {
        response = await PortOne.requestPayment({
          storeId: configuration.portoneStoreId,
          paymentId: orderId,
          orderName: portonePaymentParams.name,
          totalAmount: portonePaymentParams.amount,
          currency: 'KRW' as const,
          channelKey: configuration.channelKey,
          ...buildPortonePayMethodRequest(configuration.paymentMethod, {
            name: session?.user?.name,
            phone: deliveryPhone.trim(),
          }),
          ...(redirectUrl ? { redirectUrl } : {}),
        });
      } finally {
        // 같은 탭 복귀 뒤 새 결제가 저장한 기록은 지우지 않고 이 시도가 저장한 기록만 지운다.
        clearOwnPendingOrderPayment(browser?.storage ?? null, pending);
      }
      // 같은 탭 복귀로 상태를 되돌린 뒤 늦게 끝난 이전 결제창 결과는 무시한다.
      if (generation !== attemptGeneration.current) return;
      if (response && 'code' in response) {
        // PG 원문 코드는 화면에 쓰지 않고 고객 문구로 바꾼다. 취소인지 실패인지도 함께 담는다.
        setError(paymentFailureNotice(response));
        transition('error');
        return;
      }
      transition('idle');
    }

    sessionStorage.removeItem('checkout_cart');
    transition('done');
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
      error={cartValidationError ? failedPaymentNotice(cartValidationError) : error}
      onPay={handlePay}
    />
  );
}
/**
 * 회차 주문이 마감됐을 때 결제 버튼 바로 위에 보이는 안내(C-13). 결제 버튼은 꺼지고 돌아갈 길만 준다.
 * 다음 회차 알림은 발송 기능이 없어 넣지 않는다.
 */
function RoundClosedNotice({ onCart, onHome }: { onCart: () => void; onHome: () => void }) {
  return (
    <div
      className="mb-3 p-3"
      role="alert"
      style={{
        // 오래된 회차 정보 안내와 같은 연회색 면(design-direction.md §3.1).
        background: 'var(--color-surface-muted)',
        borderRadius: 'var(--radius)',
      }}
    >
      <p className="m-0 text-base leading-[1.55]" style={{ fontWeight: 'var(--fw-bold)' }}>
        {ROUND_ORDER_CLOSED_MESSAGE}
      </p>
      <Button size="md" className="mt-3 w-full" onClick={onCart}>
        장바구니로 가기
      </Button>
      <Button variant="ghost" size="md" className="w-full" onClick={onHome}>
        홈으로
      </Button>
    </div>
  );
}

function RoundCartCheckoutContent({ cartItems }: { cartItems: RoundCartItem[] }) {
  const { data: session } = useSession();
  const router = useRouter();
  const { removeRoundItems } = useCart();
  // 결제사 화면에서 뒤로 오거나 "다시 결제하기"로 돌아오면 같은 장바구니에서 쓰던 입력값을 복원한다(C-05).
  // 기록은 계정에 묶여 있어, 로그인한 계정이 확인된 뒤에 그 계정의 기록만 복원한다.
  const userId = session?.user?.id ?? '';
  const draftCartKey = checkoutDraftCartKey(cartItems);
  const [address, setAddress] = useState<DeliveryAddress>(EMPTY_DELIVERY_ADDRESS);
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('kakaopay');
  const [acquisition, setAcquisition] = useState<OrderAcquisitionSnapshot | null>(null);
  const storeId = cartItems[0]?.storeId ?? '';
  const saleRounds = useSaleRounds(storeId || null);
  const schedule = resolveRoundCheckoutSchedule(cartItems, saleRounds.rounds);
  // 벤치마킹 비교 기능: 선물하기(gift)
  const [gift, setGift] = useState<GiftState>(EMPTY_GIFT);
  const giftInfo = isFeatureOn('gift') ? giftPayload(gift, deliveryPhone) : null;
  // 포장 라벨(무료, 옵션 시트와 함께 켠다). 선물이면 보내는 분 이름이 라벨이라 따로 보내지 않는다.
  const [packageLabel, setPackageLabel] = useState<PackageLabelState>(EMPTY_PACKAGE_LABEL);
  // 입력값 복원을 마친 계정. 이 값이 현재 계정과 같아진 뒤에만 저장한다.
  const [draftOwnerId, setDraftOwnerId] = useState<string | null>(null);
  const giftOn = isFeatureOn('gift') && gift.enabled;
  const packageLabelValue =
    isFeatureOn('option-sheet') && !giftOn ? packageLabelPayload(packageLabel) : null;

  useEffect(() => {
    setAcquisition(getAcquisitionSnapshot());
  }, []);

  // 계정이 확인되면 그 계정의 입력값을 한 번 복원한다. 다른 계정의 기록은 복원하지 않고 지운다.
  // 아래 자동 채움 effect보다 먼저 두어, 자동 채움이 복원값 위에서 빈 칸만 채우게 한다.
  useEffect(() => {
    if (!userId || draftOwnerId === userId) return;
    const restored = loadCheckoutDraft(
      readCheckoutDraftStorage(),
      draftCartKey,
      userId,
      Date.now(),
    );
    if (restored || draftOwnerId !== null) {
      // 같은 화면에서 계정이 바뀌었으면 이전 계정의 입력을 남기지 않는다.
      setAddress(restored?.address ?? EMPTY_DELIVERY_ADDRESS);
      setDeliveryPhone(restored?.deliveryPhone ?? '');
      setRequestNote(restored?.requestNote ?? '');
      setPackageLabel(restored?.packageLabel ?? EMPTY_PACKAGE_LABEL);
    }
    setDraftOwnerId(userId);
  }, [draftCartKey, draftOwnerId, userId]);

  // 입력이 바뀔 때마다 탭 저장소에만 남긴다(개인정보라 탭을 닫으면 사라진다).
  useEffect(() => {
    if (!userId || draftOwnerId !== userId) return;
    saveCheckoutDraft(
      readCheckoutDraftStorage(),
      { address, deliveryPhone, requestNote, packageLabel },
      draftCartKey,
      userId,
      Date.now(),
    );
  }, [address, deliveryPhone, draftCartKey, draftOwnerId, packageLabel, requestNote, userId]);

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

  const { state, orderId, error, roundOrderClosed, checkoutHoldLimited, requestPayment } =
    usePayment({
      storeId,
      orderRequest: {
        deliveryAddress: address,
        deliveryPhone: deliveryPhone.trim(),
        ...(requestNote.trim() ? { requestNote: requestNote.trim() } : {}),
        ...(schedule ? { requestedDeliveryDate: schedule.requestedDeliveryDate } : {}),
        ...(acquisition ? { acquisition } : {}),
        ...(giftInfo ? { gift: giftInfo } : {}),
        ...(typeof packageLabelValue === 'string' ? { packageLabel: packageLabelValue } : {}),
      },
      roundItems: cartItems,
      accessToken: session?.user?.accessToken ?? '',
      paymentMethod,
      buyer: { name: session?.user?.name, phone: deliveryPhone.trim() },
    });

  useEffect(() => {
    if (state !== 'done' || !orderId) return;
    sessionStorage.removeItem('checkout_cart');
    clearCheckoutDraft(readCheckoutDraftStorage());
    try {
      // 바로 구매로 들어온 경우 장바구니의 다른 상품은 남겨야 하므로 결제한 회차 상품만 뺀다.
      removeRoundItems(cartItems.map((item) => item.roundItemId));
    } catch {
      // 저장소 접근이 막혀도 결제 완료 화면 이동은 막지 않는다.
    }
    router.replace(`/order/success?orderId=${orderId}`);
  }, [cartItems, orderId, removeRoundItems, router, state]);

  // 화면을 연 채 주문 마감 시각이 지나면 그 시각에 다시 그려 마감을 알아본다(C-13).
  // 타이머가 이르게 끝나 아직 마감 전이면 tick이 바뀌어 남은 시간만큼 다시 건다.
  const orderCloseAt = schedule?.round.schedule.orderCloseAt ?? null;
  const [closeTick, setCloseTick] = useState(0);
  useEffect(() => {
    void closeTick;
    if (!orderCloseAt) return;
    const delay = msUntilRoundOrderClose(orderCloseAt, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => setCloseTick((tick) => tick + 1), delay);
    return () => window.clearTimeout(timer);
  }, [closeTick, orderCloseAt]);

  // 옵션을 고른 상품은 옵션 금액을 더한 price를 쓴다(옵션이 없으면 price === roundPrice).
  const totalAmount = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const isLoading = state === 'creating' || state === 'paying';
  const roundClosed = isCheckoutRoundClosed({
    round: schedule?.round ?? null,
    nowMillis: Date.now(),
    closedByOrderResponse: roundOrderClosed,
    paymentInFlight: isLoading || state === 'done',
  });
  const scheduleError = resolveRoundScheduleError(saleRounds.status, saleRounds.error, !!schedule);
  const staleDetail = staleRoundsDetail(saleRounds.error);
  // 마감 안내가 보이면 같은 뜻의 오류(API 거절 문구·회차 확인 안내)를 겹쳐 보이지 않는다.
  const formError = roundClosed ? null : scheduleError ? failedPaymentNotice(scheduleError) : error;
  const deliveryPhoneValid = isKoreanMobilePhone(deliveryPhone.trim());
  const canPay =
    !roundClosed &&
    !isLoading &&
    !!schedule &&
    !saleRounds.isStale &&
    !!address.address &&
    !!address.zipCode &&
    deliveryPhoneValid &&
    !!session;
  // 선물을 켰으면 받는 분·보내는 분 이름을 모두 적어야 결제한다(gift).
  const giftReady = !isFeatureOn('gift') || !gift.enabled || giftInfo !== null;
  // 포장 라벨에 "문구 넣기"를 골랐으면 문구를 적어야 결제한다.
  const packageLabelReady = packageLabelValue !== 'invalid';

  return (
    <>
      {saleRounds.isRefreshing && (
        // Mantine Container(sm 720px·px md·pt sm)·Text sm dimmed(gray-6) 계산값
        <div className="mx-auto max-w-[720px] px-4 pt-3">
          <p className="m-0 text-center text-sm text-ui-gray-6" aria-live="polite">
            최신 회차 정보를 확인하는 중...
          </p>
        </div>
      )}
      {saleRounds.isStale && (
        // Mantine Container·Box(p sm)·Text sm·Button light xs(mt xs) 계산값
        <div className="mx-auto max-w-[720px] px-4 pt-3">
          <div
            className="p-3"
            role="alert"
            style={{
              // ② 테두리 상자 대신 연회색 면(design-direction.md §3.1).
              background: 'var(--color-surface-muted)',
              borderRadius: 'var(--radius)',
            }}
          >
            <p className="m-0 text-sm">최신 회차 정보를 불러오지 못했어요.</p>
            {staleDetail && (
              <p className="m-0 mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {staleDetail}
              </p>
            )}
            <Button variant="light" size="xs" className="mt-2.5" onClick={saleRounds.refetch}>
              다시 시도
            </Button>
          </div>
        </div>
      )}
      <CheckoutForm
        items={cartItems}
        totalAmount={totalAmount}
        address={address}
        onAddressChange={setAddress}
        deliveryPhone={deliveryPhone}
        onDeliveryPhoneChange={setDeliveryPhone}
        deliveryPhoneError={deliveryPhoneValid ? null : ROUND_DELIVERY_PHONE_ERROR}
        requestNote={requestNote}
        onRequestNoteChange={setRequestNote}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        isLoading={isLoading}
        canPay={canPay && giftReady && packageLabelReady}
        error={formError}
        errorAction={
          // 결제를 마치지 않은 이전 시도로 막혔으면 그 시도를 볼 수 있는 주문 내역으로 가는 길을 둔다(C-02).
          // 회차 확인 오류(scheduleError)가 대신 보일 때는 한도 안내 버튼을 붙이지 않는다.
          formError && formError === error && checkoutHoldLimited ? (
            <Button
              variant="outline"
              size="md"
              className="mt-3 w-full"
              onClick={() => router.push(CHECKOUT_HOLD_LIMIT_ORDERS_PATH)}
            >
              {CHECKOUT_HOLD_LIMIT_ORDERS_LABEL}
            </Button>
          ) : undefined
        }
        onPay={requestPayment}
        roundPayReadiness={{ phoneValid: deliveryPhoneValid, giftReady, packageLabelReady }}
        closedNotice={
          roundClosed ? (
            <RoundClosedNotice
              onCart={() => router.push('/cart')}
              onHome={() => router.push('/')}
            />
          ) : undefined
        }
        benchmark={{
          arrivalLabel:
            isFeatureOn('arrival-everywhere') && schedule
              ? formatRoundTime(schedule.round.schedule.deliveryEndAt)
              : null,
          gift: isFeatureOn('gift') ? { value: gift, onChange: setGift } : undefined,
          packageLabel: isFeatureOn('option-sheet')
            ? { value: packageLabel, onChange: setPackageLabel }
            : undefined,
        }}
      />
    </>
  );
}

function CartCheckoutContent() {
  const router = useRouter();
  const [cart, setCart] = useState<LoadedCheckoutCart>({ kind: 'loading', items: [] });

  useEffect(() => {
    const readCart = () => {
      try {
        setCart(parseCheckoutCart(sessionStorage.getItem('checkout_cart')));
      } catch {
        setCart({ kind: 'invalid', items: [] });
      }
    };
    readCart();
    // 결제사 화면에서 뒤로 와 페이지가 메모리에서 그대로 복원되면(C-01) 결제 상태는 결제 전으로 되돌아간다.
    // 그사이 결제가 끝나 결제 상품이 비워졌을 수 있으니 같은 상품을 다시 결제하지 않게 새로 읽는다.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) readCart();
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  if (cart.kind === 'loading') {
    return (
      // Mantine Container(sm·px md·py lg)·Text 계산값
      <div className="mx-auto max-w-[720px] px-4 py-5">
        <p className="m-0 text-base">결제 상품을 확인하는 중...</p>
      </div>
    );
  }
  if (cart.kind === 'invalid') {
    // 새 탭·주소 직접 열기처럼 탭 저장소에 결제할 상품이 없으면 막다른 화면 대신 돌아갈 길을 준다.
    return (
      <div className="mx-auto max-w-[720px] px-4 py-5">
        <p className="m-0 text-base leading-[1.55]">
          결제할 상품 정보가 없어요. 장바구니에서 다시 결제해 주세요.
        </p>
        <Button size="lg" className="mt-5 w-full" onClick={() => router.push('/cart')}>
          장바구니로 가기
        </Button>
        <Button variant="ghost" size="md" className="w-full" onClick={() => router.push('/')}>
          홈으로
        </Button>
      </div>
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
          <div className="mx-auto max-w-[720px] px-4 py-5">
            <p className="m-0 text-base">로딩 중...</p>
          </div>
        }
      >
        <CheckoutContent />
      </Suspense>
    </>
  );
}
