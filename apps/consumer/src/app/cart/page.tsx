'use client';
import { Alert } from '@greenhub/ui/components/alert';
import { Badge } from '@greenhub/ui/components/badge';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import { ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ButtonLabel, ButtonLink } from '@/components/Button';
import { CartArrivalLine, CartUpsell, IcheonPrecheck } from '@/components/benchmark/CartExtras';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import { type CartItem, isRoundCartItem, type RoundCartItem, useCart } from '@/hooks/useCart';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { getCartItemValidationIssues, getCartValidationError } from '@/lib/cartValidation';
import { isFeatureOn } from '@/lib/features';
import { formatOrderCloseLabel, isRoundOrderClosed } from '@/lib/round-schedule-label';

const API_URL = getApiBaseUrl();
type RoundCartValidation =
  | { status: 'eligible'; currentUnitPrice: number }
  | { status: 'price_changed'; currentUnitPrice: number; reason: string }
  | { status: 'unavailable'; reason: string };
type ValidationByKey = Record<string, RoundCartValidation | undefined>;
type ValidationState =
  | { status: 'idle'; items: ValidationByKey }
  | { status: 'loading'; items: ValidationByKey }
  | { status: 'ready'; items: ValidationByKey };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
// 장바구니에는 옵션을 고르는 칸이 없으므로, 옵션을 고르지 않고 담긴 상품은 상품 화면으로 돌아가게 안내한다.
const OPTION_REQUIRED_REASON =
  '옵션을 골라야 하는 상품이에요. 상품 화면에서 옵션을 고른 뒤 다시 담아 주세요.';
// 서버 안내 중 해결 방법이 문장에 들어 있는 것(옵션 재고, 한 분당 수량, 이전 결제 시도)은 그대로 보여 준다.
const ACTIONABLE_SERVER_REASON = /골라 주세요|한 분당|남았어요|다 팔렸어요|이전 결제 시도/;
const HANGUL = /[가-힣]/;
const MAX_SERVER_REASON_LENGTH = 160;
// 확인 요청이 실패했거나 응답을 믿을 수 없을 때 보이는 고객 문구. 내부 용어("서버")를 쓰지 않는다.
const UNVERIFIED_REASON = '구매 가능 여부를 아직 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
// 내부 용어가 든 안내는 손님에게 그대로 보이지 않고 일반 문구로 바꾼다.
const INTERNAL_TERM = /서버/;

// 안내를 문장 단위로 나눠 내부 용어가 든 문장만 뺀다. 남은 문장(해결 방법)은 그대로 이어 붙인다.
function withoutInternalSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !INTERNAL_TERM.test(sentence))
    .join(' ')
    .trim();
}

function unavailableReason(message?: string) {
  if (!message) return UNVERIFIED_REASON;
  const trimmed = message.trim();
  // 해결 방법이 든 안내를 먼저 본다. 내부 용어가 든 문장은 빼고 남은 문장으로 판정해, 해결 방법은 살리고
  // 내부 용어는 화면에 내지 않는다.
  // 옵션 안내는 원문 대신 고정 문구를 보이므로, 내부 용어와 같은 문장에 있어도 원문 전체로 판정한다.
  if (/옵션을 묶음마다/.test(trimmed)) return OPTION_REQUIRED_REASON;
  const actionable = withoutInternalSentences(trimmed);
  if (ACTIONABLE_SERVER_REASON.test(actionable) && actionable.length <= MAX_SERVER_REASON_LENGTH) {
    return actionable;
  }
  // 해결 방법이 없는데 내부 용어가 든 안내는 일반 문구로 바꾼다.
  if (INTERNAL_TERM.test(trimmed)) return UNVERIFIED_REASON;
  if (/수량|한도|품절/.test(trimmed)) return '요청한 수량을 구매할 수 없습니다.';
  if (/마감|현재 주문 가능한 회차|구매할 수 없는/.test(trimmed)) return '판매가 마감되었습니다.';
  if (/찾을 수 없/.test(trimmed)) return '현재 구매할 수 없는 상품입니다.';
  // 그 밖의 한국어 안내는 손님에게 보여 주려고 쓴 문장이라 그대로 보인다. 검증 기술 메시지(영문)나
  // 지나치게 긴 응답은 일반 문구로 바꾼다.
  if (HANGUL.test(trimmed) && trimmed.length <= MAX_SERVER_REASON_LENGTH) return trimmed;
  return UNVERIFIED_REASON;
}
function readErrorMessage(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (typeof value.message === 'string') return value.message;
  if (Array.isArray(value.message)) {
    return value.message.find((message): message is string => typeof message === 'string');
  }
  return undefined;
}
function cartItemKey(item: CartItem) {
  return isRoundCartItem(item)
    ? `${item.roundId}:${item.roundItemId}:${item.productId}`
    : `legacy:${item.productId}`;
}
function buildRoundCartValidationRequest(value: RoundCartItem | RoundCartItem[]) {
  const items = Array.isArray(value) ? value : [value];
  const item = items[0];
  if (!item) throw new Error('검증할 회차 상품이 없습니다.');
  return {
    productId: item.productId,
    quantity: item.quantity,
    saleType: 'normal' as const,
    deliveryMethod: 'direct' as const,
    // 기존 주문 DTO를 재사용하는 검증 API의 필수 형식이다. 고객 개인정보는 전송하지 않는다.
    requestedDeliveryDate: '1970-01-01',
    deliveryAddress: {
      address: '경기도 이천시',
      addressDetail: '',
      zipCode: '',
    },
    deliveryPhone: '00000000',
    roundId: item.roundId,
    roundItems: items.map(({ roundItemId, quantity, optionChoiceIds }) => ({
      roundItemId,
      quantity,
      // 옵션 시트(벤치마킹 비교 기능)로 고른 옵션. 없으면 기존 요청과 같다.
      ...(optionChoiceIds?.length ? { optionChoiceIds } : {}),
    })),
  };
}
function resolveRoundCartValidation(
  item: RoundCartItem,
  value: unknown,
  failureMessage?: string,
): RoundCartValidation {
  if (failureMessage) {
    return { status: 'unavailable', reason: unavailableReason(failureMessage) };
  }
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length !== 1) {
    return { status: 'unavailable', reason: UNVERIFIED_REASON };
  }
  const serverItem = value.items[0];
  if (
    value.ok !== true ||
    value.salesMode !== 'round_direct' ||
    value.roundId !== item.roundId ||
    !isRecord(serverItem) ||
    serverItem.roundItemId !== item.roundItemId ||
    serverItem.productId !== item.productId ||
    serverItem.quantity !== item.quantity ||
    value.itemQuantityTotal !== item.quantity ||
    !isPrice(serverItem.unitPrice) ||
    serverItem.subtotalAmount !== serverItem.unitPrice * item.quantity ||
    value.totalAmount !== serverItem.subtotalAmount
  ) {
    return { status: 'unavailable', reason: UNVERIFIED_REASON };
  }
  // 옵션을 고른 상품은 옵션 금액을 더한 가격(price)과 비교한다. 옵션이 없으면 price === roundPrice.
  if (serverItem.unitPrice !== item.price) {
    return {
      status: 'price_changed',
      currentUnitPrice: serverItem.unitPrice,
      reason: '가격이 변경되어 확인이 필요합니다.',
    };
  }
  return { status: 'eligible', currentUnitPrice: serverItem.unitPrice };
}
function unavailableValidations(items: RoundCartItem[], message?: string): ValidationByKey {
  return Object.fromEntries(
    items.map((item) => [
      cartItemKey(item),
      {
        status: 'unavailable',
        reason: message ? unavailableReason(message) : UNVERIFIED_REASON,
      },
    ]),
  );
}
function resolveRoundCartBatchValidation(items: RoundCartItem[], value: unknown): ValidationByKey {
  if (
    items.length === 0 ||
    !isRecord(value) ||
    value.ok !== true ||
    value.salesMode !== 'round_direct' ||
    value.roundId !== items[0]?.roundId ||
    !items.every((item) => item.roundId === value.roundId) ||
    !Array.isArray(value.items) ||
    value.items.length !== items.length
  ) {
    return unavailableValidations(items);
  }
  const resolved: ValidationByKey = {};
  let quantityTotal = 0;
  let totalAmount = 0;
  for (const item of items) {
    const matches = value.items.filter(
      (candidate) => isRecord(candidate) && candidate.roundItemId === item.roundItemId,
    );
    if (matches.length !== 1 || !isRecord(matches[0]) || !isPrice(matches[0].subtotalAmount)) {
      return unavailableValidations(items);
    }
    const serverItem = matches[0];
    resolved[cartItemKey(item)] = resolveRoundCartValidation(item, {
      ...value,
      itemQuantityTotal: item.quantity,
      totalAmount: serverItem.subtotalAmount,
      items: [serverItem],
    });
    quantityTotal += item.quantity;
    totalAmount += serverItem.subtotalAmount as number;
  }
  if (value.itemQuantityTotal !== quantityTotal || value.totalAmount !== totalAmount) {
    return unavailableValidations(items);
  }
  return resolved;
}
// 도착 안내와 이번 회차 추가 제안은 회차 주문을 받는 동안만 보인다. 마감 뒤에는 지킬 수 없는 도착 약속과
// 담아도 결제할 수 없는 제안이 되므로 숨긴다.
function roundExtrasRound<T>(cartRound: T | null, roundOrderClosed: boolean): T | null {
  return roundOrderClosed ? null : cartRound;
}
function selectCheckoutItems(items: CartItem[], validationByKey: ValidationByKey) {
  if (!items.every(isRoundCartItem)) return items;
  return items.filter((item) => validationByKey[cartItemKey(item)]?.status === 'eligible');
}
async function postRoundCartValidation(
  items: RoundCartItem[],
  accessToken: string,
  signal: AbortSignal,
) {
  try {
    const response = await fetch(
      `${API_URL}/stores/${encodeURIComponent(items[0]?.storeId ?? '')}/orders/validate-cart`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(buildRoundCartValidationRequest(items)),
        signal,
      },
    );
    const body = (await response.json().catch(() => null)) as unknown;
    return response.ok
      ? ({ ok: true, body } as const)
      : ({ ok: false, message: readErrorMessage(body) } as const);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return { ok: false, message: undefined } as const;
  }
}
const VALIDATION_DEBOUNCE_MS = 300;
// 서버는 상품마다 따로(재고·회차·배송 지역) 판정하므로 묶음 검증이 통과하면 상품별 검증도 모두 통과한다.
// 그래서 묶음 1회를 먼저 보내고, 실패했을 때만 상품별로 보내 어느 상품이 왜 안 되는지 찾는다.
async function validateRoundCartItems(
  roundItems: RoundCartItem[],
  accessToken: string,
  signal: AbortSignal,
): Promise<ValidationByKey> {
  const batch = await postRoundCartValidation(roundItems, accessToken, signal);
  if (batch.ok) return resolveRoundCartBatchValidation(roundItems, batch.body);
  if (roundItems.length === 1) return unavailableValidations(roundItems, batch.message);

  const results = await Promise.all(
    roundItems.map(async (item) => {
      const response = await postRoundCartValidation([item], accessToken, signal);
      const result = response.ok
        ? resolveRoundCartValidation(item, response.body)
        : resolveRoundCartValidation(item, null, response.message);
      return [cartItemKey(item), result] as const;
    }),
  );
  let resolved = Object.fromEntries(results) as ValidationByKey;
  const candidates = roundItems.filter(
    (item) => resolved[cartItemKey(item)]?.status === 'eligible',
  );
  if (candidates.length > 1) {
    const response = await postRoundCartValidation(candidates, accessToken, signal);
    resolved = {
      ...resolved,
      ...(response.ok
        ? resolveRoundCartBatchValidation(candidates, response.body)
        : unavailableValidations(candidates, response.message)),
    };
  }
  return resolved;
}
function useRoundCartValidation(
  items: CartItem[],
  accessToken: string | undefined,
  sessionStatus: 'authenticated' | 'loading' | 'unauthenticated',
) {
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle', items: {} });
  const validatedOnceRef = useRef(false);
  // "다시 확인"을 누를 때마다 1씩 늘려 같은 확인을 다시 실행한다.
  const [retryCount, setRetryCount] = useState(0);
  const handledRetryRef = useRef(0);
  const retry = useCallback(() => setRetryCount((count) => count + 1), []);
  useEffect(() => {
    const isRetry = retryCount !== handledRetryRef.current;
    handledRetryRef.current = retryCount;
    const roundItems = items.filter(isRoundCartItem);
    if (roundItems.length === 0) {
      setValidation({ status: 'idle', items: {} });
      return;
    }
    if (sessionStatus === 'loading') {
      setValidation({ status: 'loading', items: {} });
      return;
    }
    if (!accessToken) {
      setValidation({
        status: 'ready',
        items: Object.fromEntries(
          roundItems.map((item) => [
            cartItemKey(item),
            { status: 'unavailable', reason: '로그인 후 구매 가능 여부를 확인해 주세요.' },
          ]),
        ),
      });
      return;
    }

    const controller = new AbortController();
    let active = true;
    // 다시 확인하는 동안은 앞선 실패 안내를 그대로 두고(버튼이 "확인 중"으로 남는다) 결과가 오면 바꾼다.
    setValidation((previous) => ({ status: 'loading', items: isRetry ? previous.items : {} }));
    // 수량 +/−를 연달아 누르는 동안은 요청을 보내지 않고 마지막 수량만 검증한다(첫 검증과 다시 확인은 바로).
    const delay = !isRetry && validatedOnceRef.current ? VALIDATION_DEBOUNCE_MS : 0;
    validatedOnceRef.current = true;
    const timer = setTimeout(() => {
      void validateRoundCartItems(roundItems, accessToken, controller.signal)
        .then((resolved) => {
          if (active) setValidation({ status: 'ready', items: resolved });
        })
        .catch((error: unknown) => {
          if (active && !(error instanceof Error && error.name === 'AbortError')) {
            setValidation({
              status: 'ready',
              items: unavailableValidations(roundItems),
            });
          }
        });
    }, delay);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [accessToken, items, sessionStatus, retryCount]);
  return { validation, retry };
}
/**
 * "다시 확인" 버튼 상태. 확인 요청이 실패한 상품(일반 실패 문구)이 있을 때만 보이고, 확인하는 동안은
 * 누를 수 없게 "checking"으로 둔다(중복 요청을 막는다).
 */
function validationRetryState(validation: ValidationState): 'hidden' | 'checking' | 'ready' {
  const unverified = Object.values(validation.items).some(
    (item) => item?.status === 'unavailable' && item.reason === UNVERIFIED_REASON,
  );
  if (!unverified) return 'hidden';
  return validation.status === 'ready' ? 'ready' : 'checking';
}
// Mantine ActionIcon(subtle dark·radius xl) 계산값: UnstyledButton 위에 정사각, 투명 1px 테두리,
// dark-9 글자, 줄 높이 1, 글꼴은 물려받는다. 마우스를 올리면(hover 가능한 기기만) dark-light-hover(dark-2) 면.
// 크기는 눌리는 영역 44px(--touch-target, design-standard §4)이다.
const QUANTITY_BUTTON =
  'relative m-0 inline-flex size-11 min-h-11 min-w-11 cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[32px] border border-solid border-transparent bg-transparent p-0 text-left leading-none text-ui-dark-light-text no-underline select-none [font-family:inherit] [font-size:inherit] [font-weight:inherit] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:translate-y-px [@media(hover:hover)]:hover:bg-ui-dark-light-hover';
// 꺼진 수량 버튼: 꺼진 글자색, 누름·마우스 올림 반응 없음.
const QUANTITY_BUTTON_DISABLED =
  'disabled:cursor-default disabled:text-[var(--color-text-disabled)] disabled:active:translate-y-0 [@media(hover:hover)]:disabled:hover:bg-transparent';

function RoundValidationNotice({ validation }: { validation: RoundCartValidation | undefined }) {
  if (!validation) {
    return (
      <p
        className="m-0 mt-1.5 p-0 text-sm font-normal"
        style={{ color: 'var(--color-text-secondary)' }}
        role="status"
      >
        구매 가능 여부 확인 중
      </p>
    );
  }
  if (validation.status === 'eligible') {
    return (
      <p
        className="m-0 mt-1.5 p-0 text-xs"
        style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary-dark)' }}
      >
        구매 가능
      </p>
    );
  }
  if (validation.status === 'price_changed') {
    return (
      <div className="mt-1.5 flex flex-col gap-0.5" role="alert">
        <p className="m-0 p-0 text-sm font-normal" style={{ color: 'var(--color-danger)' }}>
          가격이 변경되었습니다: 현재 회차 가격{' '}
          {validation.currentUnitPrice.toLocaleString('ko-KR')}원
        </p>
        <p className="m-0 p-0 text-sm font-normal" style={{ color: 'var(--color-danger)' }}>
          결제 대상에서 제외되었습니다.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-col gap-0.5" role="alert">
      <p className="m-0 p-0 text-sm font-normal" style={{ color: 'var(--color-danger)' }}>
        {validation.reason}
      </p>
      <p className="m-0 p-0 text-sm font-normal" style={{ color: 'var(--color-danger)' }}>
        결제 대상에서 제외되었습니다.
      </p>
    </div>
  );
}
export default function CartPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { items, updateQuantity, removeItem, clearCart } = useCart();
  // 비회원 장바구니(guest-cart): 로그인 전에는 담은 상품만 보여주고, 주문할 때 로그인한다.
  const isGuest = isFeatureOn('guest-cart') && sessionStatus === 'unauthenticated';
  const { validation, retry: retryValidation } = useRoundCartValidation(
    items,
    session?.user?.accessToken,
    sessionStatus,
  );
  const retryState = validationRetryState(validation);
  const isRoundCart = items.length > 0 && items.every(isRoundCartItem);
  const checkoutItems = selectCheckoutItems(items, validation.items);
  const checkoutAmount = checkoutItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const checkoutCount = checkoutItems.reduce((sum, item) => sum + item.quantity, 0);
  const excludedCount = isRoundCart ? items.length - checkoutItems.length : 0;
  const legacyItems = items.filter((item) => !isRoundCartItem(item));
  const legacyValidationError = getCartValidationError(legacyItems);
  const hasLegacyValidationIssues = legacyValidationError !== null;
  const isChecking = isRoundCart && validation.status !== 'ready';
  const guestAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  function handleCheckout() {
    if (isGuest) {
      void signIn(undefined, { callbackUrl: '/cart' });
      return;
    }
    if (checkoutItems.length === 0 || isChecking || hasLegacyValidationIssues) return;
    sessionStorage.setItem('checkout_cart', JSON.stringify(checkoutItems));
    router.push('/checkout?from=cart');
  }
  // 회차 장바구니면 같은 회차의 주문 마감 시각을 가져와 노란 안내에 쓴다(실패하면 안내만 숨긴다).
  const firstRoundItem = items.find(isRoundCartItem) ?? null;
  const saleRounds = useSaleRounds(isRoundCart ? (firstRoundItem?.storeId ?? null) : null);
  const cartRound =
    firstRoundItem && saleRounds.currentRound?.id === firstRoundItem.roundId
      ? saleRounds.currentRound
      : null;
  // 장바구니 회차의 주문이 끝났는지 공개 회차 정보로 판정한다(로그인 전에도). 다음 회차가 열리면 지금 회차가
  // 바뀌므로 받은 회차 목록 전체에서 찾는다. 목록에 없으면 알 수 없으므로 막지 않는다(로그인 뒤 서버 검증이 정한다).
  const itemsRound = firstRoundItem
    ? (saleRounds.rounds.find((round) => round.id === firstRoundItem.roundId) ?? null)
    : null;
  const roundOrderClosed =
    isRoundCart && itemsRound !== null && isRoundOrderClosed(itemsRound, Date.now());
  const deadlineNotice = roundOrderClosed
    ? '이번 회차 주문이 마감됐어요.'
    : cartRound
      ? `${formatOrderCloseLabel(cartRound.schedule.orderCloseAt)} 결제해야 이번 회차로 배송돼요.`
      : null;
  const extrasRound = roundExtrasRound(cartRound, roundOrderClosed);

  if (items.length === 0) {
    return (
      // Mantine Container(sm 720px·px md·py 64)·Stack(align center·gap md) 계산값
      <div className="mx-auto max-w-[720px] px-4 py-16">
        <div className="flex flex-col items-center justify-start gap-4">
          <div
            aria-hidden
            style={{
              alignItems: 'center',
              background: 'var(--color-surface-muted)',
              borderRadius: 'var(--radius-full)',
              color: 'var(--color-text-secondary)',
              display: 'flex',
              height: 72,
              justifyContent: 'center',
              width: 72,
            }}
          >
            <ShoppingBag size={32} strokeWidth={1.8} />
          </div>
          <p
            className="m-0 p-0 text-base font-normal"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            장바구니가 비어있습니다.
          </p>
          {/* 링크 의미(a)를 유지한다: Mantine Button component={Link}와 같은 모양 */}
          <ButtonLink render={<Link href="/" />} size="md">
            <ButtonLabel>쇼핑하러 가기</ButtonLabel>
          </ButtonLink>
        </div>
      </div>
    );
  }
  return (
    // Mantine Container(sm 720px·px md·pt lg·pb 100)·Group(mb md)·Title order 1(줄 높이 1.3) 계산값
    <div className="mx-auto max-w-[720px] px-4 pt-5 pb-[100px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h1
          className="m-0 leading-[1.3]"
          style={{
            color: 'var(--color-text)',
            fontSize: 22,
            fontWeight: 'var(--fw-extrabold)',
            letterSpacing: '-0.01em',
          }}
        >
          장바구니
        </h1>
        <Button variant="ghost" size="xs" onClick={clearCart}>
          전체 삭제
        </Button>
      </div>
      {isRoundCart && (
        <div className="mb-4 flex flex-col gap-2.5">
          <div
            className="p-4"
            style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
          >
            <div className="flex flex-nowrap items-start justify-between gap-4">
              <div>
                <p
                  className="m-0 p-0 text-sm"
                  style={{ fontWeight: 'var(--fw-extrabold)', color: 'var(--color-text)' }}
                >
                  이번 주 판매
                </p>
                <p
                  className="m-0 p-0 text-sm font-normal"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  이번 회차 상품을 한 번에 결제해요.
                </p>
              </div>
              {/* 비로그인 장바구니(guest-cart)는 서버 확인을 하지 않으므로 확인 표시를 두지 않는다. */}
              {!isGuest && (
                // ② 방향(design-standard §5): 상태는 배지 면 없이 점 + 글자. 확인 중=회색, 확인 완료=검정.
                <StatusDot tone={isChecking ? 'done' : 'default'} className="shrink-0 font-bold">
                  {isChecking ? '확인 중' : '확인 완료'}
                </StatusDot>
              )}
            </div>
          </div>
          {deadlineNotice && (
            <div
              className="px-4 py-3"
              style={{
                background: 'var(--color-deadline-surface)',
                borderRadius: 'var(--radius)',
                color: 'var(--color-deadline-text)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
              }}
            >
              {deadlineNotice}
            </div>
          )}
          {extrasRound && <CartArrivalLine round={extrasRound} />}
          {isGuest && !roundOrderClosed && (
            <div
              className="px-4 py-3"
              style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
            >
              <p className="m-0 p-0 text-sm font-bold">
                로그인하면 구매 가능 여부와 최신 가격을 확인하고 바로 주문할 수 있어요.
              </p>
            </div>
          )}
          <IcheonPrecheck />
        </div>
      )}
      {/* ② 방향(design-standard §4·§5): 테두리 카드 대신 줄 목록. 카드 안에 연회색 요소(사진 바탕·수량 조절)가 많아 면 대신 줄 사이 선으로 나눈다. */}
      <div className="mb-5 flex flex-col">
        {items.map((item) => {
          const roundItem = isRoundCartItem(item) ? item : null;
          const itemIssues = roundItem ? [] : getCartItemValidationIssues(item);
          const productHref = roundItem
            ? `/products/${item.productId}?round=${encodeURIComponent(roundItem.roundId)}`
            : `/products/${item.productId}`;
          const itemValidation = roundItem ? validation.items[cartItemKey(roundItem)] : undefined;
          // 공개 회차가 품절로 보이는 상품은 이유를 알 수 있게 태그를 단다(결제 제외는 서버 검증이 정한다).
          const soldOut =
            roundItem !== null &&
            cartRound?.items.some(
              (candidate) =>
                candidate.id === roundItem.roundItemId && candidate.status === 'SOLD_OUT',
            ) === true;
          return (
            <div
              key={cartItemKey(item)}
              className="border-0 border-solid border-[var(--color-border)] py-3 not-first:border-t"
            >
              <div className="flex flex-nowrap items-start justify-start gap-4">
                <Link
                  href={productHref}
                  style={{
                    width: 76,
                    height: 76,
                    background: 'var(--color-surface-muted)',
                    flexShrink: 0,
                    borderRadius: 12,
                    overflow: 'hidden',
                    display: 'block',
                    position: 'relative',
                  }}
                >
                  <ResilientImage
                    fill
                    src={item.image || PRODUCT_IMAGE_FALLBACK}
                    fallbackSrc={PRODUCT_IMAGE_FALLBACK}
                    alt={item.name}
                    sizes="76px"
                    style={{ objectFit: 'cover' }}
                  />
                </Link>
                {/* 줄 배치(design-standard §4): 첫 줄은 상품 이름(긴 이름은 자르지 않고 줄을 나눈다), 둘째 줄 왼쪽은 가격·상태,
                    오른쪽은 44px "삭제", 셋째 줄은 수량과 금액이다. 읽는 순서(이름 → 삭제 → 가격·상태)는 그대로다. */}
                <div
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-1"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Link
                    href={productHref}
                    className="col-span-2 m-0 justify-self-start p-0 text-sm [overflow-wrap:anywhere] [word-break:keep-all]"
                    style={{
                      fontWeight: 'var(--fw-extrabold)',
                      color: 'var(--color-text)',
                      display: 'block',
                      minWidth: 0,
                      textDecoration: 'none',
                    }}
                  >
                    {item.name}
                  </Link>
                  <Button
                    variant="ghost"
                    size="compact-sm"
                    className="col-start-2 row-start-2 self-start"
                    aria-label={`${item.name} 삭제`}
                    onClick={() => removeItem(item.productId)}
                  >
                    삭제
                  </Button>
                  <div className="col-start-1 row-start-2 min-w-0 self-center">
                    {roundItem ? (
                      <>
                        <span
                          style={{
                            background: 'var(--color-surface-muted)',
                            borderRadius: 'var(--radius-tag)',
                            color: 'var(--color-text)',
                            display: 'inline-block',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 'var(--fw-bold)',
                            marginTop: 4,
                            padding: '2px 7px',
                          }}
                        >
                          회차 가격 {roundItem.roundPrice.toLocaleString('ko-KR')}원
                        </span>
                        {roundItem.optionLabel && (
                          <p
                            className="m-0 mt-1 p-0 text-sm font-normal"
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            {roundItem.optionLabel}
                            {roundItem.optionPriceDelta
                              ? ` (+${roundItem.optionPriceDelta.toLocaleString('ko-KR')}원)`
                              : ''}
                          </p>
                        )}
                        {soldOut && (
                          <span
                            style={{
                              background: 'var(--color-surface-muted)',
                              borderRadius: 'var(--radius-tag)',
                              color: 'var(--color-text-secondary)',
                              display: 'inline-block',
                              fontSize: 'var(--font-size-xs)',
                              fontWeight: 'var(--fw-bold)',
                              marginLeft: 6,
                              marginTop: 4,
                              padding: '2px 7px',
                            }}
                          >
                            품절
                          </span>
                        )}
                        {!isGuest && <RoundValidationNotice validation={itemValidation} />}
                      </>
                    ) : (
                      <>
                        {item.saleType === 'group' && (
                          <Badge size="xs" variant="light" className="mt-1">
                            공동구매
                          </Badge>
                        )}
                        {item.requestedDeliveryDate && (
                          <p
                            className="m-0 mt-1 p-0 text-sm font-normal"
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            배송 희망일{' '}
                            {new Date(item.requestedDeliveryDate).toLocaleDateString('ko-KR', {
                              month: 'long',
                              day: 'numeric',
                              weekday: 'short',
                            })}
                          </p>
                        )}
                        {itemIssues.length > 0 && (
                          // Mantine Alert light orange(orange-1 면·orange-9 글자, p xs, 본문 검정 15px)
                          <Alert
                            role="alert"
                            className="mt-3 bg-ui-orange-light p-2.5 text-ui-orange-light-text"
                          >
                            <div className="overflow-hidden text-[15px] text-ellipsis text-ui-ink">
                              <div className="flex flex-col gap-1">
                                {itemIssues.map((issue) => (
                                  <p key={issue.code} className="m-0 p-0 text-sm font-normal">
                                    {issue.itemMessage}
                                  </p>
                                ))}
                                {/* 링크 의미(a)를 유지한다: Mantine Button component={Link} light orange xs */}
                                <ButtonLink
                                  render={<Link href={productHref} />}
                                  variant="light"
                                  size="xs"
                                  className="mt-1 bg-ui-orange-light text-ui-orange-light-text"
                                >
                                  <ButtonLabel>다시 선택하기</ButtonLabel>
                                </ButtonLink>
                              </div>
                            </div>
                          </Alert>
                        )}
                      </>
                    )}
                  </div>
                  <div className="col-span-2 mt-3 flex flex-nowrap items-center justify-between gap-4">
                    <div
                      className="flex flex-nowrap items-center justify-start gap-0.5 px-0.5"
                      style={{
                        background: 'var(--color-surface-muted)',
                        borderRadius: 'var(--radius-full)',
                      }}
                    >
                      {/* 수량 1에서 줄이면 확인 없이 상품이 빠지므로 막는다. 빼기는 "삭제" 버튼으로만 한다. */}
                      <button
                        type="button"
                        className={`${QUANTITY_BUTTON} ${QUANTITY_BUTTON_DISABLED}`}
                        aria-label={`${item.name} 수량 줄이기`}
                        disabled={item.quantity <= 1}
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                      >
                        −
                      </button>
                      <p
                        className="m-0 w-6 p-0 text-center text-sm"
                        style={{
                          fontWeight: 'var(--fw-extrabold)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {item.quantity}
                      </p>
                      <button
                        type="button"
                        className={QUANTITY_BUTTON}
                        aria-label={`${item.name} 수량 늘리기`}
                        onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    <p
                      className="m-0 p-0 text-base"
                      style={{
                        fontWeight: 'var(--fw-extrabold)',
                        color: 'var(--color-text)',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {(item.price * item.quantity).toLocaleString('ko-KR')}원
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {extrasRound && <CartUpsell round={extrasRound} items={items} />}
      {excludedCount > 0 && !isGuest && (
        <div
          className="mb-4 p-3"
          role="alert"
          style={{ background: 'var(--color-danger-surface)', borderRadius: 'var(--radius)' }}
        >
          <p
            className="m-0 p-0 text-sm"
            style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-danger)' }}
          >
            변경·마감·구매 불가 상품 {excludedCount}개는 장바구니에 남아 있으며 결제 대상에서
            제외됩니다.
          </p>
          {/* 확인 요청이 실패한 상품이 있으면 새로고침 없이 같은 확인을 다시 실행한다. */}
          {retryState !== 'hidden' && (
            <Button
              type="button"
              variant="light-destructive"
              className="mt-2.5"
              disabled={retryState === 'checking'}
              onClick={() => {
                if (retryState === 'ready') retryValidation();
              }}
            >
              {retryState === 'checking' ? '다시 확인하는 중' : '다시 확인'}
            </Button>
          )}
        </div>
      )}
      <div
        className="mb-4 flex flex-col gap-2 p-4"
        style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p
            className="m-0 p-0 text-sm font-normal"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            결제 대상 상품 수
          </p>
          <p
            className="m-0 p-0 text-sm font-normal"
            style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}
          >
            {isGuest ? items.reduce((sum, item) => sum + item.quantity, 0) : checkoutCount}개
          </p>
        </div>
        <div
          className="flex flex-wrap items-baseline justify-between gap-4 pt-2.5"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <p
            className="m-0 p-0 text-sm"
            style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
          >
            총 결제 금액
          </p>
          <p
            className="m-0 p-0 leading-[1.55]"
            style={{
              color: 'var(--color-text)',
              fontSize: 22,
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 'var(--fw-extrabold)',
            }}
          >
            {(isGuest ? guestAmount : checkoutAmount).toLocaleString('ko-KR')}원
          </p>
        </div>
      </div>
      {hasLegacyValidationIssues && (
        <p
          className="m-0 mb-2.5 p-0 text-center text-sm font-normal"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          문제 있는 상품을 다시 선택하면 결제할 수 있어요.
        </p>
      )}
      {isGuest ? (
        // 비로그인 장바구니(guest-cart): 로그인한 뒤 같은 장바구니로 돌아온다.
        // 회차 주문이 끝났으면 로그인해도 주문할 수 없으므로 버튼을 막고 이유를 보인다.
        <>
          {roundOrderClosed && (
            <p
              className="m-0 mb-2.5 p-0 text-center text-sm font-normal"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              이번 회차 주문이 마감돼서 지금은 주문할 수 없어요.
            </p>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={roundOrderClosed}
            onClick={handleCheckout}
          >
            로그인하고 주문하기
          </Button>
        </>
      ) : (
        <Button
          size="lg"
          className="w-full"
          disabled={checkoutItems.length === 0 || isChecking || hasLegacyValidationIssues}
          onClick={handleCheckout}
        >
          {isChecking
            ? '구매 가능 여부 확인 중'
            : isRoundCart
              ? `${checkoutCount}개 상품 한 번에 결제`
              : '결제하기'}
        </Button>
      )}
    </div>
  );
}
