/**
 * PortOne V2 결제창의 리다이렉트 복귀 계약.
 *
 * `redirectUrl`을 주고 `forceRedirect`를 주지 않으면 PC는 기존처럼 Promise로 결과를 받고,
 * 모바일(카카오톡 인앱 브라우저·iOS Safari 등)은 같은 탭에서 결제사 화면으로 이동했다가
 * `redirectUrl`로 돌아온다. 이때 결과는 쿼리 문자열로만 온다.
 * - 공통: `paymentId`
 * - 실패·취소 시: `code`, `message` (`pgCode`, `pgMessage`는 PG 원문이라 화면에 쓰지 않는다)
 * - 선택: `transactionType`(일반결제는 항상 `PAYMENT`), `txId`
 *
 * 쿼리는 위·변조될 수 있으므로 성공 쿼리만으로 결제 완료를 확정하지 않는다.
 * 확정은 서버(웹훅으로 갱신되는 주문·재배송비 상태) 조회로만 한다.
 */

export const ORDER_PAYMENT_REDIRECT_PATH = '/order/success';
export const PENDING_ORDER_PAYMENT_STORAGE_KEY = 'greenhub_pending_order_payment';

const MAX_IDENTIFIER_LENGTH = 128;
const UNSAFE_IDENTIFIER_CHARACTERS = '/?#\\';
const MAX_MESSAGE_LENGTH = 200;
const MAX_ROUND_ITEMS = 100;
// 결제창에서 오래 머문 경우까지 고려하되, 남은 기록이 다른 결제의 정리에 쓰이지 않게 제한한다.
const PENDING_ORDER_PAYMENT_TTL_MS = 2 * 60 * 60 * 1000;

export const DEFAULT_PAYMENT_FAILURE_MESSAGE = '결제가 취소되었거나 완료되지 않았습니다.';

export interface PaymentRedirectQuery {
  getAll(name: string): string[];
}

export type PaymentRedirectResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'failure'; paymentId: string | null; code: string; message: string | null }
  | { kind: 'success'; paymentId: string };

/** 결제 전에 저장하고 리다이렉트 복귀 뒤 한 번만 소비하는 주문 결제 정보. 결제 시도 ID는 담지 않는다. */
export interface PendingOrderPayment {
  version: 1;
  paymentId: string;
  /** 결제 성공 뒤 로컬 장바구니에서 뺄 회차 상품(#328과 같은 의미). */
  roundItemIds: string[];
  /** 결제 성공 뒤 sessionStorage `checkout_cart`를 비울지 여부. */
  clearCheckoutCart: boolean;
  /** legacy 장바구니에서 이번 결제 뒤 아직 결제되지 않은 상품 수. */
  unpaidItemCount: number;
  /** 실패·취소 뒤 다시 결제할 체크아웃 경로. */
  retryPath: string | null;
  createdAt: number;
}

export type OrderPaymentReturn =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'failure'; message: string; retryPath: string | null }
  | {
      kind: 'confirm';
      orderId: string;
      roundItemIds: string[];
      clearCheckoutCart: boolean;
      unpaidItemCount: number;
    };

export type RedeliveryPaymentReturn =
  | { kind: 'none' }
  | { kind: 'rejected'; message: string }
  | { kind: 'uncertain'; message: string }
  | { kind: 'reconciling' }
  | { kind: 'done' };

interface PaymentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSafePaymentIdentifier(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value.trim() !== value
  ) {
    return false;
  }
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || UNSAFE_IDENTIFIER_CHARACTERS.includes(character);
  });
}

function sanitizeMessage(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > MAX_MESSAGE_LENGTH ? `${cleaned.slice(0, MAX_MESSAGE_LENGTH)}…` : cleaned;
}

/** 리다이렉트 복귀 쿼리를 해석한다. `code`가 있으면 값과 무관하게 실패로 본다(성공으로 오인 금지). */
export function parsePaymentRedirectResult(query: PaymentRedirectQuery): PaymentRedirectResult {
  const paymentIds = query.getAll('paymentId');
  const codes = query.getAll('code');
  if (paymentIds.length === 0 && codes.length === 0) return { kind: 'none' };

  const messages = query.getAll('message');
  const transactionTypes = query.getAll('transactionType');
  if (
    paymentIds.length > 1 ||
    codes.length > 1 ||
    messages.length > 1 ||
    transactionTypes.length > 1 ||
    (transactionTypes.length === 1 && transactionTypes[0] !== 'PAYMENT')
  ) {
    return { kind: 'invalid' };
  }

  const paymentId = paymentIds[0];
  if (paymentId !== undefined && !isSafePaymentIdentifier(paymentId)) return { kind: 'invalid' };

  const code = codes[0];
  if (code !== undefined) {
    return {
      kind: 'failure',
      paymentId: paymentId ?? null,
      code: code.trim() || 'UNKNOWN',
      message: sanitizeMessage(messages[0]),
    };
  }
  return paymentId === undefined ? { kind: 'invalid' } : { kind: 'success', paymentId };
}

/** 현재 origin 기준 절대 복귀 URL. http(s) origin과 같은 사이트 경로만 허용한다. */
export function buildPaymentRedirectUrl(origin: string, path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const url = new URL(path, base.origin);
  return url.origin === base.origin ? url.href : null;
}

export function redeliveryPaymentRedirectPath(orderId: string): string {
  return `/mypage/orders/${encodeURIComponent(orderId)}`;
}

function isRetryPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    (value === '/checkout' || value.startsWith('/checkout?')) &&
    !value.includes('\\')
  );
}

export function createPendingOrderPayment(input: {
  paymentId: string;
  roundItemIds?: readonly string[];
  clearCheckoutCart: boolean;
  unpaidItemCount?: number;
  retryPath: string | null;
  now: number;
}): PendingOrderPayment | null {
  const roundItemIds = [...(input.roundItemIds ?? [])];
  const unpaidItemCount = input.unpaidItemCount ?? 0;
  if (
    !isSafePaymentIdentifier(input.paymentId) ||
    roundItemIds.length > MAX_ROUND_ITEMS ||
    !roundItemIds.every(isSafePaymentIdentifier) ||
    !Number.isSafeInteger(unpaidItemCount) ||
    unpaidItemCount < 0 ||
    !Number.isSafeInteger(input.now)
  ) {
    return null;
  }
  return {
    version: 1,
    paymentId: input.paymentId,
    roundItemIds,
    clearCheckoutCart: input.clearCheckoutCart,
    unpaidItemCount,
    retryPath: isRetryPath(input.retryPath) ? input.retryPath : null,
    createdAt: input.now,
  };
}

export function readPendingOrderPayment(
  raw: string | null,
  now: number,
): PendingOrderPayment | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.clearCheckoutCart !== 'boolean' ||
    !Array.isArray(value.roundItemIds) ||
    typeof value.createdAt !== 'number' ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt > now ||
    now - value.createdAt > PENDING_ORDER_PAYMENT_TTL_MS ||
    (value.retryPath !== null && !isRetryPath(value.retryPath))
  ) {
    return null;
  }
  return createPendingOrderPayment({
    paymentId: value.paymentId as string,
    roundItemIds: value.roundItemIds as string[],
    clearCheckoutCart: value.clearCheckoutCart,
    unpaidItemCount: value.unpaidItemCount as number,
    retryPath: value.retryPath as string | null,
    now: value.createdAt,
  });
}

/**
 * 주문 결제 복귀 처리 방침.
 * - 실패·취소: 안내 + 체크아웃으로 돌아가는 길만 준다. 결제 시도 ID는 저장하지 않으므로
 *   다시 결제하면 새 clientOrderRequestId로 주문한다(#328 의미).
 * - 성공 쿼리: 주문 ID(= paymentId)로 서버 상태를 조회해 확정한다. 장바구니 정리는
 *   결제 전에 저장한 기록과 paymentId가 일치할 때만 한다.
 */
export function resolveOrderPaymentReturn(
  result: PaymentRedirectResult,
  pending: PendingOrderPayment | null,
): OrderPaymentReturn {
  if (result.kind === 'none' || result.kind === 'invalid') return result;
  const matchesPending =
    pending !== null && (result.paymentId === null || pending.paymentId === result.paymentId);

  if (result.kind === 'failure') {
    return {
      kind: 'failure',
      message: result.message ?? DEFAULT_PAYMENT_FAILURE_MESSAGE,
      retryPath: matchesPending ? pending.retryPath : null,
    };
  }
  return {
    kind: 'confirm',
    orderId: result.paymentId,
    roundItemIds: matchesPending ? pending.roundItemIds : [],
    clearCheckoutCart: matchesPending ? pending.clearCheckoutCart : false,
    unpaidItemCount: matchesPending ? pending.unpaidItemCount : 0,
  };
}

/**
 * 재배송비 결제 복귀 처리. 성공 쿼리여도 서버의 `redeliveryPayment.paid`가 true일 때만 완료로 본다.
 * `paid`가 undefined면 아직 서버 상태를 읽지 못한 것이다.
 */
export function resolveRedeliveryPaymentReturn(
  result: PaymentRedirectResult,
  paid: boolean | undefined,
): RedeliveryPaymentReturn {
  if (result.kind === 'none') return { kind: 'none' };
  if (result.kind === 'invalid') {
    return {
      kind: 'uncertain',
      message: '재배송비 결제 결과를 확인할 수 없습니다. 중복 결제 전에 상태를 다시 확인해 주세요.',
    };
  }
  // 서버가 이미 결제 완료로 확인했다면 쿼리보다 서버 상태를 따른다.
  if (paid === true) return { kind: 'done' };
  if (result.kind === 'failure') {
    return { kind: 'rejected', message: result.message ?? '재배송비 결제가 취소되었습니다.' };
  }
  if (paid === undefined) return { kind: 'reconciling' };
  return {
    kind: 'uncertain',
    message:
      '결제 요청은 접수되었지만 서버 확인 전입니다. 중복 결제 전에 잠시 후 다시 확인해 주세요.',
  };
}

export function savePendingOrderPayment(
  storage: PaymentStorage | null,
  pending: PendingOrderPayment | null,
): void {
  if (!storage) return;
  try {
    if (pending) storage.setItem(PENDING_ORDER_PAYMENT_STORAGE_KEY, JSON.stringify(pending));
    else storage.removeItem(PENDING_ORDER_PAYMENT_STORAGE_KEY);
  } catch {
    // 저장소가 막혀도 결제는 진행한다. 복귀 뒤 장바구니 정리만 생략된다.
  }
}

/** 저장된 기록을 한 번만 읽고 지운다. */
export function takePendingOrderPayment(
  storage: PaymentStorage | null,
  now: number,
): PendingOrderPayment | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_ORDER_PAYMENT_STORAGE_KEY);
    storage.removeItem(PENDING_ORDER_PAYMENT_STORAGE_KEY);
    return readPendingOrderPayment(raw, now);
  } catch {
    return null;
  }
}

export interface BrowserPaymentContext {
  origin: string;
  currentPath: string;
  storage: PaymentStorage | null;
}

export function readBrowserPaymentContext(): BrowserPaymentContext | null {
  if (typeof window === 'undefined') return null;
  let storage: PaymentStorage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return {
    origin: window.location.origin,
    currentPath: `${window.location.pathname}${window.location.search}`,
    storage,
  };
}
