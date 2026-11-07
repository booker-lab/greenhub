'use client';

import type { CreateOrderRequest } from '@greenhub/shared';
import { useEffect, useRef, useState } from 'react';
import { type CartItem, isRoundCartItem, type RoundCartItem } from '@/hooks/useCart';
import { getApiBaseUrl } from '@/lib/api-base-url';
import {
  CHECKOUT_PAYMENT_UNAVAILABLE_MESSAGE,
  checkoutPaymentErrorMessage,
  ORDER_CREATE_FAILED_MESSAGE,
} from '@/lib/checkout-messages';
import {
  isRoundOrderClosedRejection,
  ROUND_ORDER_CLOSED_MESSAGE,
} from '@/lib/checkout-round-closed';
import { paymentFailureMessage } from '@/lib/payment-failure-message';
import { attachPaymentPageGuard } from '@/lib/payment-page-guard';
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
  type PortoneBuyer,
  type PortonePaymentMethod,
  readPortonePaymentConfiguration,
} from '@/lib/portone-config';

export type PaymentMethod = PortonePaymentMethod;
export type PaymentState = 'idle' | 'creating' | 'paying' | 'done' | 'error';

interface BasePaymentOptions {
  storeId: string;
  accessToken: string;
  paymentMethod: PaymentMethod;
  /** 카드 결제창에 기본값으로 넘길 구매자 이름·전화. */
  buyer?: PortoneBuyer;
}

export type RoundPaymentOrderRequest = Pick<
  CreateOrderRequest,
  'deliveryAddress' | 'deliveryPhone'
> &
  Partial<
    Pick<
      CreateOrderRequest,
      'requestedDeliveryDate' | 'acquisition' | 'requestNote' | 'gift' | 'packageLabel'
    >
  >;

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
  /** 회차 결제에서 주문 생성 API가 회차 주문 마감으로 거절했는지(C-13). 한 번 알아보면 이 화면에서는 유지한다. */
  roundOrderClosed: boolean;
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
// 결제 전 확인에 실패하면 화면에 보일 고객 문구(해요체).
const ROUND_AMOUNT_UNCHECKED_MESSAGE =
  '결제 금액을 확인하지 못했어요. 장바구니에서 다시 결제해 주세요.';
const ORDER_RESPONSE_UNCHECKED_MESSAGE =
  '결제 정보를 확인하지 못해 결제를 시작하지 않았어요. 잠시 후 다시 시도해 주세요.';

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
    throw new Error('결제할 상품이 없어요. 장바구니에서 다시 결제해 주세요.');
  }
  if (!roundItems.every((item) => isValidRoundPaymentItem(item, storeId))) {
    throw new Error('상품 정보를 확인하지 못했어요. 장바구니에서 다시 결제해 주세요.');
  }

  const firstItem = roundItems[0];
  if (!firstItem || roundItems.some((item) => item.roundId !== firstItem.roundId)) {
    throw new Error('같은 회차 상품만 함께 결제할 수 있어요.');
  }
  const roundItemIds = roundItems.map((item) => item.roundItemId);
  if (new Set(roundItemIds).size !== roundItemIds.length) {
    throw new Error('같은 상품이 두 번 담겨 있어요. 장바구니에서 확인해 주세요.');
  }

  const expectedAmount = roundItems.reduce((sum, item) => {
    // 옵션을 고른 상품은 옵션 금액을 더한 price, 아니면 price === roundPrice.
    const subtotal = item.price * item.quantity;
    if (!Number.isSafeInteger(subtotal) || subtotal < 0) {
      throw new Error(ROUND_AMOUNT_UNCHECKED_MESSAGE);
    }
    return sum + subtotal;
  }, 0);
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) {
    throw new Error(ROUND_AMOUNT_UNCHECKED_MESSAGE);
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
      ...(orderRequest.acquisition ? { acquisition: orderRequest.acquisition } : {}),
      ...(orderRequest.requestNote ? { requestNote: orderRequest.requestNote } : {}),
      ...(orderRequest.gift ? { gift: orderRequest.gift } : {}),
      ...(orderRequest.packageLabel ? { packageLabel: orderRequest.packageLabel } : {}),
      roundId: firstItem.roundId,
      roundItems: roundItems.map((item) => ({
        roundItemId: item.roundItemId,
        quantity: item.quantity,
        ...(item.optionChoiceIds?.length ? { optionChoiceIds: item.optionChoiceIds } : {}),
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
    throw new Error(ORDER_RESPONSE_UNCHECKED_MESSAGE);
  }
  if ('paymentId' in value && value.paymentId !== value.orderId) {
    throw new Error(ORDER_RESPONSE_UNCHECKED_MESSAGE);
  }

  const parameters = value.portonePaymentParams;
  if (
    !isRecord(parameters) ||
    !isNonEmptyString(parameters.name) ||
    !isMoney(parameters.amount) ||
    parameters.amount <= 0
  ) {
    throw new Error(ORDER_RESPONSE_UNCHECKED_MESSAGE);
  }
  if ('paymentId' in parameters && parameters.paymentId !== value.orderId) {
    throw new Error(ORDER_RESPONSE_UNCHECKED_MESSAGE);
  }
  if (expectedAmount !== undefined && parameters.amount !== expectedAmount) {
    throw new Error(
      '결제 금액이 장바구니와 달라 결제를 시작하지 않았어요. 장바구니에서 다시 확인해 주세요.',
    );
  }

  return {
    orderId: value.orderId,
    paymentId: value.orderId,
    name: parameters.name,
    amount: parameters.amount,
  };
}

/**
 * 서버가 이번 요청으로 주문을 만들지 않고 확정 거절한 4xx인지 판정한다.
 * 408(요청 시간 초과)·429(요청 제한)는 재시도 대상이라 결제 시도 ID를 유지한다.
 */
function isSettledRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function usePayment(options: UsePaymentOptions): UsePaymentResult {
  const [state, setState] = useState<PaymentState>('idle');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundOrderClosed, setRoundOrderClosed] = useState(false);
  const paymentAttemptId = useRef<string | null>(null);
  const currentState = useRef<PaymentState>('idle');
  // 같은 탭 복귀로 결제 상태를 되돌리면 올라간다. 끝나지 않은 이전 결제창 결과가 늦게 와도 화면을 바꾸지 않는다.
  const attemptGeneration = useRef(0);

  function transition(nextState: PaymentState) {
    currentState.current = nextState;
    setState(nextState);
  }

  // 주문 생성 중에만 이탈 확인창을 띄우고, 결제사 화면에서 뒤로 와 페이지가 그대로 복원되면
  // "처리 중..."에 고정되지 않게 결제 전 상태로 되돌린다(C-01). 단계는 동기적으로 갱신되는 ref로 판단한다.
  useEffect(
    () =>
      attachPaymentPageGuard(window, {
        getPhase: () => currentState.current,
        onRestore: () => {
          attemptGeneration.current += 1;
          // 새로 로드된 복귀와 같게 다음 결제는 새 결제 시도 ID로 주문한다(#328).
          paymentAttemptId.current = null;
          currentState.current = 'idle';
          setState('idle');
          setError(null);
        },
      }),
    [],
  );

  async function requestPayment() {
    if (currentState.current !== 'idle' && currentState.current !== 'error') return;
    const generation = attemptGeneration.current;
    transition('creating');
    setError(null);
    paymentAttemptId.current ??= crypto.randomUUID();
    // 서버 거절·결제창 취소처럼 결과가 확정된 실패에서만 결제 시도 ID를 새로 만든다.
    // 응답 없음·5xx처럼 서버 처리 여부가 불확실하면 같은 ID로 멱등 재시도해야 한다.
    let attemptSettled = false;

    try {
      let configuration: ReturnType<typeof readPortonePaymentConfiguration>;
      try {
        configuration = readPortonePaymentConfiguration(options.paymentMethod);
      } catch {
        // 결제 설정 오류 원문 대신 고객 문구를 보인다.
        throw new Error(CHECKOUT_PAYMENT_UNAVAILABLE_MESSAGE);
      }
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
        attemptSettled = isSettledRejection(res.status);
        const body = await res.json().catch(() => ({}));
        // 회차 주문 창이 닫혀 거절되면(예약·주문을 만들지 않는다) 화면이 마감 안내로 바꿀 수 있게 알린다.
        if (options.roundItems !== undefined && isRoundOrderClosedRejection(res.status, body)) {
          setRoundOrderClosed(true);
          throw new Error(ROUND_ORDER_CLOSED_MESSAGE);
        }
        throw new Error(body.message ?? ORDER_CREATE_FAILED_MESSAGE);
      }
      const payment = readOrderPaymentResponse(await res.json(), prepared.expectedAmount);
      setOrderId(payment.orderId);

      transition('paying');
      const PortOne = await import('@portone/browser-sdk/v2');
      // 모바일은 같은 탭에서 결제사로 이동했다가 redirectUrl로 돌아온다(PC는 그대로 Promise).
      // 페이지가 새로 로드되므로 복귀 뒤 장바구니 정리에 필요한 정보만 sessionStorage에 남긴다.
      // 결제 시도 ID는 남기지 않는다: 복귀 뒤 다시 결제하면 새 ID로 주문한다(#328).
      const browser = readBrowserPaymentContext();
      const redirectUrl = browser
        ? buildPaymentRedirectUrl(browser.origin, ORDER_PAYMENT_REDIRECT_PATH)
        : null;
      const pending = createPendingOrderPayment({
        paymentId: payment.paymentId,
        roundItemIds: options.roundItems?.map((item) => item.roundItemId),
        clearCheckoutCart: options.roundItems !== undefined,
        retryPath: browser?.currentPath ?? null,
        now: Date.now(),
      });
      savePendingOrderPayment(browser?.storage ?? null, pending);
      let response: Awaited<ReturnType<typeof PortOne.requestPayment>>;
      try {
        response = await PortOne.requestPayment({
          storeId: configuration.portoneStoreId,
          paymentId: payment.paymentId,
          orderName: payment.name,
          totalAmount: payment.amount,
          currency: 'KRW' as const,
          channelKey: configuration.channelKey,
          ...buildPortonePayMethodRequest(configuration.paymentMethod, options.buyer),
          ...(redirectUrl ? { redirectUrl } : {}),
        });
      } finally {
        // Promise로 결과를 받은 경우(PC·결제창 오류)에는 이 화면이 직접 처리하므로 복귀용 기록을 지운다.
        // 같은 탭 복귀 뒤 새 결제가 저장한 기록은 이 시도의 것이 아니므로 남긴다.
        clearOwnPendingOrderPayment(browser?.storage ?? null, pending);
      }
      if (generation !== attemptGeneration.current) return;

      if (response && 'code' in response) {
        attemptSettled = true;
        // PG 원문 코드("[PAY_PROCESS_CANCELED] …")는 화면에 쓰지 않고 고객 문구로 바꾼다.
        throw new Error(paymentFailureMessage(response));
      }

      transition('done');
    } catch (e: unknown) {
      if (generation !== attemptGeneration.current) return;
      if (attemptSettled) paymentAttemptId.current = null;
      setError(checkoutPaymentErrorMessage(e));
      transition('error');
    }
  }

  return { state, orderId, error, roundOrderClosed, requestPayment };
}
