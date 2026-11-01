'use client';

import type { OrderStatus } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { CircleAlert, CircleCheck, CircleX, Clock } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Suspense, useEffect, useRef, useState } from 'react';
import OrderSuccessGuide from '@/components/benchmark/OrderSuccessGuide';
import { useCart } from '@/hooks/useCart';
import { useOrderStatus } from '@/hooks/useOrderStatus';
import { isFeatureOn } from '@/lib/features';
import { formatCancelReason } from '@/lib/order-cancel-reason';
import {
  DEFAULT_PAYMENT_FAILURE_MESSAGE,
  type OrderPaymentReturn,
  type PaymentRedirectResult,
  parsePaymentRedirectResult,
  readBrowserPaymentContext,
  resolveOrderPaymentReturn,
  takePendingOrderPayment,
} from '@/lib/payment-redirect';

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중...',
  RECRUITING: '공동구매 모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '주문 접수 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  DELIVERY_HELD: '배송 보류',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '리뷰 완료',
};

const ORDER_STATUSES = new Set<OrderStatus>([
  'PENDING',
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'DELIVERY_HELD',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'REVIEWED',
]);
const SUCCESS_STATUSES = new Set<OrderStatus>(['ACCEPTED', 'RECRUITING']);
const WAITING_OR_CANCELLED_STATUSES = new Set<OrderStatus>(['PENDING', 'CANCELLED']);
const MAX_IDENTIFIER_LENGTH = 128;
const UNSAFE_IDENTIFIER_CHARACTERS = '/?#\\';
const ROUND_ORDER_NUMBER_PATTERN = /^\d{8}-\d{6}$/;

interface SuccessOrderItem {
  id: string;
  productName: string;
  quantity: number;
  subtotalAmount: number;
}

interface SuccessOrderView {
  orderNumber: string;
  isRoundOrder: boolean;
  items: SuccessOrderItem[];
  totalQuantity: number;
  totalAmount: number;
}

type ValidOrderRecord = Record<string, unknown> & {
  id: string;
  status: OrderStatus;
};

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

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseOrderId(values: string[]): string | null {
  return values.length === 1 && isSafeIdentifier(values[0]) ? values[0] : null;
}

/**
 * 조회할 주문 ID. 모바일 결제 리다이렉트 복귀는 `paymentId`(= 주문 ID)로 오고,
 * 기존 Promise 완료 경로는 `orderId`로 온다. 실패·손상 복귀는 조회하지 않는다.
 */
function resolveSuccessOrderId(
  orderIdValues: string[],
  redirectResult: PaymentRedirectResult,
): string | null {
  if (redirectResult.kind === 'failure' || redirectResult.kind === 'invalid') return null;
  if (redirectResult.kind === 'success') {
    if (orderIdValues.length > 0 && parseOrderId(orderIdValues) !== redirectResult.paymentId) {
      return null;
    }
    return redirectResult.paymentId;
  }
  return parseOrderId(orderIdValues);
}

function readOrderRecord(value: unknown, requestedOrderId: string): ValidOrderRecord | null {
  if (
    !isRecord(value) ||
    !isSafeIdentifier(value.id) ||
    value.id !== requestedOrderId ||
    typeof value.status !== 'string' ||
    !ORDER_STATUSES.has(value.status as OrderStatus)
  ) {
    return null;
  }
  return value as ValidOrderRecord;
}

function readRoundOrderItems(value: unknown): SuccessOrderItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const items: SuccessOrderItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isSafeIdentifier(item.roundItemId) ||
      !isSafeIdentifier(item.productId) ||
      !isNonEmptyString(item.productName) ||
      !isMoney(item.unitPrice) ||
      !isPositiveQuantity(item.quantity) ||
      !isMoney(item.subtotalAmount)
    ) {
      return null;
    }
    const expectedSubtotal = item.unitPrice * item.quantity;
    if (!Number.isSafeInteger(expectedSubtotal) || item.subtotalAmount !== expectedSubtotal) {
      return null;
    }
    items.push({
      id: item.roundItemId,
      productName: item.productName,
      quantity: item.quantity,
      subtotalAmount: item.subtotalAmount,
    });
  }
  return new Set(items.map((item) => item.id)).size === items.length ? items : null;
}

function readSuccessOrder(value: unknown, requestedOrderId: string): SuccessOrderView | null {
  const order = readOrderRecord(value, requestedOrderId);
  if (!order || !SUCCESS_STATUSES.has(order.status)) return null;

  const hasRoundIdentity =
    order.schemaVersion === 2 || (order.roundId !== undefined && order.roundId !== null);
  if (!hasRoundIdentity) {
    if (order.orderNumber !== undefined && !isSafeIdentifier(order.orderNumber)) return null;
    return {
      orderNumber: order.orderNumber ?? requestedOrderId,
      isRoundOrder: false,
      items: [],
      totalQuantity: 0,
      totalAmount: 0,
    };
  }

  if (
    order.schemaVersion !== 2 ||
    !isSafeIdentifier(order.roundId) ||
    typeof order.orderNumber !== 'string' ||
    !ROUND_ORDER_NUMBER_PATTERN.test(order.orderNumber) ||
    order.saleType !== 'normal' ||
    order.deliveryMethod !== 'direct' ||
    order.deliveryFee !== 0 ||
    !isMoney(order.totalAmount)
  ) {
    return null;
  }

  const items = readRoundOrderItems(order.orderItems);
  if (!items) return null;
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.subtotalAmount, 0);
  if (
    !Number.isSafeInteger(totalQuantity) ||
    !Number.isSafeInteger(totalAmount) ||
    order.totalAmount !== totalAmount
  ) {
    return null;
  }

  return {
    orderNumber: order.orderNumber,
    isRoundOrder: true,
    items,
    totalQuantity,
    totalAmount,
  };
}

// 결제 확인(PENDING)·성공(ACCEPTED/RECRUITING)·취소 외의 유효 상태는 이미 결제가 끝나
// 다음 단계로 진행된 주문이다(뒤로 가기·재진입 등). 빈 화면 대신 접수 안내를 보인다.
function isReceivedStatus(status: OrderStatus): boolean {
  return (
    ORDER_STATUSES.has(status) &&
    !SUCCESS_STATUSES.has(status) &&
    !WAITING_OR_CANCELLED_STATUSES.has(status)
  );
}

type StatusTone = 'success' | 'waiting' | 'danger';

const STATUS_TONE: Record<StatusTone, { background: string; color: string }> = {
  success: { background: 'var(--color-primary-surface)', color: 'var(--color-primary)' },
  waiting: { background: 'var(--color-deadline-surface)', color: 'var(--color-deadline-text)' },
  danger: { background: 'var(--color-danger-surface)', color: 'var(--color-danger)' },
};

const STATUS_ICON = { success: CircleCheck, waiting: Clock, danger: CircleX, alert: CircleAlert };

// 결과 화면 맨 위의 둥근 상태 아이콘(디자인 기준: 이모지 대신 색 원 + 선 아이콘)
function StatusMark({ tone, icon }: { tone: StatusTone; icon: keyof typeof STATUS_ICON }) {
  const Icon = STATUS_ICON[icon];
  return (
    <div
      aria-hidden
      className="mb-1"
      style={{
        ...STATUS_TONE[tone],
        alignItems: 'center',
        borderRadius: 'var(--radius-full)',
        display: 'flex',
        height: 72,
        justifyContent: 'center',
        width: 72,
      }}
    >
      <Icon size={36} strokeWidth={2.2} />
    </div>
  );
}

const resultTitleStyle = {
  fontSize: 22,
  fontWeight: 'var(--fw-extrabold)',
  letterSpacing: '-0.01em',
  textAlign: 'center',
} as const;

function OrderResultActions({ onOrders, onHome }: { onOrders: () => void; onHome: () => void }) {
  return (
    <>
      <Button size="lg" className="mt-5 w-full" onClick={onOrders}>
        주문 내역 보기
      </Button>
      <Button variant="ghost" size="md" className="w-full" onClick={onHome}>
        홈으로
      </Button>
    </>
  );
}

function ErrorState({ message, onHome }: { message: string; onHome: () => void }) {
  return (
    <>
      <StatusMark tone="danger" icon="alert" />
      <h1 className="m-0 leading-[1.3]" style={resultTitleStyle}>
        주문 정보를 불러올 수 없습니다
      </h1>
      <p
        className="m-0 leading-[1.55]"
        style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
      >
        {message}
      </p>
      <Button size="lg" className="mt-4 w-full" onClick={onHome}>
        홈으로
      </Button>
    </>
  );
}

function OrderSuccessContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { removeRoundItems } = useCart();
  const redirectResult = parsePaymentRedirectResult(params);
  const redirectSearch = redirectResult.kind === 'none' ? null : params.toString();
  const orderId = resolveSuccessOrderId(params.getAll('orderId'), redirectResult);
  const [paymentReturn, setPaymentReturn] = useState<OrderPaymentReturn | null>(null);
  const handledRedirect = useRef<string | null>(null);
  const { order, loading, error, pollingExpired, refetch } = useOrderStatus(
    orderId,
    session?.user?.accessToken,
  );
  const validOrder = orderId ? readOrderRecord(order, orderId) : null;
  const successOrder = !loading && !error && orderId ? readSuccessOrder(order, orderId) : null;

  useEffect(() => {
    if (!orderId && !redirectSearch) router.replace('/');
  }, [orderId, redirectSearch, router]);

  // 모바일 결제 리다이렉트 복귀: 결제 전 기록을 한 번만 꺼내 장바구니 정리(#328)·재시도 경로를 정한다.
  // 결제 확정은 아래 주문 상태 조회(서버)로만 한다.
  useEffect(() => {
    if (!redirectSearch || handledRedirect.current === redirectSearch) return;
    handledRedirect.current = redirectSearch;
    const browser = readBrowserPaymentContext();
    const resolved = resolveOrderPaymentReturn(
      parsePaymentRedirectResult(new URLSearchParams(redirectSearch)),
      takePendingOrderPayment(browser?.storage ?? null, Date.now()),
    );
    if (resolved.kind === 'confirm') {
      try {
        if (resolved.clearCheckoutCart) browser?.storage?.removeItem('checkout_cart');
        if (resolved.roundItemIds.length > 0) removeRoundItems(resolved.roundItemIds);
      } catch {
        // 저장소 접근이 막혀도 결제 결과 확인은 막지 않는다.
      }
    }
    setPaymentReturn(resolved);
  }, [redirectSearch, removeRoundItems]);

  useEffect(() => {
    if (validOrder?.status !== 'CANCELLED') return;
    // 결제 실패 화면 유지(payment-fail-stay): 다시 결제하기를 누를 수 있게 자동으로 홈에 보내지 않는다.
    if (isFeatureOn('payment-fail-stay')) return;
    const timer = setTimeout(() => router.replace('/'), 4000);
    return () => clearTimeout(timer);
  }, [router, validOrder?.status]);

  const isPending = !error && validOrder?.status === 'PENDING';
  const isCancelled = !error && validOrder?.status === 'CANCELLED';
  const isReceived = !loading && !error && !!validOrder && isReceivedStatus(validOrder.status);
  const responseError =
    !loading &&
    !error &&
    !!orderId &&
    (!order ||
      !validOrder ||
      (validOrder && SUCCESS_STATUSES.has(validOrder.status) && !successOrder));
  const paymentFailure = redirectResult.kind === 'failure' ? redirectResult : null;
  const retryPath = paymentReturn?.kind === 'failure' ? paymentReturn.retryPath : null;
  const unpaidItemCount = paymentReturn?.kind === 'confirm' ? paymentReturn.unpaidItemCount : 0;
  const errorMessage = paymentFailure
    ? null
    : redirectResult.kind === 'invalid'
      ? '결제 결과를 확인할 수 없습니다. 주문 내역에서 결제 상태를 확인해 주세요.'
      : !orderId
        ? '올바른 주문번호가 필요합니다.'
        : error ||
          (responseError
            ? '주문 응답을 확인할 수 없습니다. 주문 내역에서 다시 확인해 주세요.'
            : null);

  return (
    // Mantine Container(sm 720px·px md·py 60)·Stack(align center·gap xs 10px) 계산값
    <div className="mx-auto max-w-[720px] px-4 py-[60px]">
      <div className="flex flex-col items-center justify-start gap-2.5">
        {!!orderId && !errorMessage && (loading || isPending) && (
          <>
            <StatusMark tone="waiting" icon="waiting" />
            <h1 className="m-0 leading-[1.3]" style={resultTitleStyle}>
              결제 확인 중...
            </h1>
            <p
              className="m-0 text-center leading-[1.55]"
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
            >
              {isPending && pollingExpired
                ? '결제 확인이 늦어지고 있어요. 잠시 후 다시 확인해 주세요.'
                : '잠시만 기다려주세요. 결제 완료 후 자동으로 업데이트됩니다.'}
            </p>
            {isPending && pollingExpired && (
              <Button size="lg" className="mt-4 w-full" onClick={() => void refetch()}>
                다시 확인
              </Button>
            )}
          </>
        )}

        {successOrder && validOrder && (
          <>
            <StatusMark tone="success" icon="success" />
            <h1 className="m-0 leading-[1.3]" style={resultTitleStyle}>
              주문이 완료되었습니다
            </h1>
            <p
              className="m-0 text-base"
              style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary-dark)' }}
            >
              {STATUS_LABELS[validOrder.status]}
            </p>
            {validOrder.status === 'RECRUITING' && (
              <p
                className="m-0 leading-[1.55]"
                style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
              >
                공동구매 목표 달성 시 주문이 확정됩니다.
              </p>
            )}
            <p
              className="m-0 mt-2.5 leading-[1.55]"
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
            >
              {successOrder.isRoundOrder ? '회차 주문번호' : '주문번호'}: {successOrder.orderNumber}
            </p>

            {successOrder.isRoundOrder && (
              <>
                <div
                  className="mt-5 w-full p-4"
                  style={{
                    background: 'var(--color-surface-muted)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
                    <p className="m-0 text-base" style={{ fontWeight: 'var(--fw-extrabold)' }}>
                      주문 상품
                    </p>
                    <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      총 {successOrder.items.length}개 상품 · {successOrder.totalQuantity}개
                    </p>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {successOrder.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-start justify-between gap-4"
                      >
                        <p className="m-0 text-sm">
                          {item.productName} × {item.quantity}
                        </p>
                        <p className="m-0 text-sm">{item.subtotalAmount.toLocaleString()}원</p>
                      </div>
                    ))}
                    <div
                      className="mt-2.5 flex flex-wrap items-baseline justify-between gap-4 pt-2.5"
                      style={{ borderTop: '1px solid var(--color-border)' }}
                    >
                      <p className="m-0 text-sm" style={{ fontWeight: 'var(--fw-bold)' }}>
                        결제 금액
                      </p>
                      <p
                        className="m-0 leading-[1.55]"
                        style={{
                          fontSize: 22,
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 'var(--fw-extrabold)',
                        }}
                      >
                        {successOrder.totalAmount.toLocaleString()}원
                      </p>
                    </div>
                  </div>
                </div>

                {isFeatureOn('order-success-guide') ? (
                  <OrderSuccessGuide requestedDeliveryDate={order?.requestedDeliveryDate ?? null} />
                ) : (
                  <div
                    className="mt-3 w-full p-4"
                    style={{
                      background: 'var(--color-primary-surface)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <p
                      className="m-0 mb-1 text-sm"
                      style={{
                        fontWeight: 'var(--fw-extrabold)',
                        color: 'var(--color-primary-dark)',
                      }}
                    >
                      화요일 배송 안내
                    </p>
                    <p className="m-0 text-sm">
                      화요일 오전 9시까지 문 앞 배송합니다. 경기도 이천시 직접배송 주문입니다.
                    </p>
                  </div>
                )}
              </>
            )}

            <OrderResultActions
              onOrders={() => router.push('/mypage')}
              onHome={() => router.push('/')}
            />
          </>
        )}

        {isReceived && validOrder && !errorMessage && (
          <>
            <StatusMark tone="success" icon="success" />
            <h1 className="m-0 leading-[1.3]" style={resultTitleStyle}>
              주문이 접수되었습니다
            </h1>
            <p
              className="m-0 text-base"
              style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary-dark)' }}
            >
              현재 상태: {STATUS_LABELS[validOrder.status] ?? '주문 진행 중'}
            </p>
            <p
              className="m-0 text-center leading-[1.55]"
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
            >
              결제가 완료된 주문입니다. 진행 상황은 주문 내역에서 확인해 주세요.
            </p>
            <OrderResultActions
              onOrders={() => router.push('/mypage')}
              onHome={() => router.push('/')}
            />
          </>
        )}

        {isCancelled && validOrder && !errorMessage && (
          <>
            <StatusMark tone="danger" icon="danger" />
            <h1 className="m-0 leading-[1.3]" style={resultTitleStyle}>
              결제가 취소되었습니다
            </h1>
            <p
              className="m-0 text-center leading-[1.55]"
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
            >
              {formatCancelReason(validOrder.cancelReason) ?? '결제 처리 중 오류가 발생했습니다.'}
            </p>
            {!isFeatureOn('payment-fail-stay') && (
              <p
                className="m-0 leading-[1.55]"
                style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
              >
                잠시 후 홈 화면으로 이동합니다.
              </p>
            )}
            {/* 결제 실패 화면 유지(payment-fail-stay): 홈으로 보내는 대신 장바구니에서 다시 결제할 길을 준다. */}
            {isFeatureOn('payment-fail-stay') && (
              <>
                <Button size="lg" className="mt-5 w-full" onClick={() => router.push('/cart')}>
                  장바구니에서 다시 결제하기
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  className="w-full"
                  onClick={() => router.push('/')}
                >
                  홈으로
                </Button>
              </>
            )}
          </>
        )}

        {paymentFailure && (
          <>
            <StatusMark tone="danger" icon="danger" />
            <h1 className="m-0 leading-[1.3]" style={resultTitleStyle}>
              결제가 완료되지 않았습니다
            </h1>
            <p
              className="m-0 text-center leading-[1.55]"
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
            >
              {paymentFailure.message ?? DEFAULT_PAYMENT_FAILURE_MESSAGE}
            </p>
            {retryPath && (
              <Button size="lg" className="mt-5 w-full" onClick={() => router.replace(retryPath)}>
                다시 결제하기
              </Button>
            )}
            <Button variant="ghost" size="md" className="w-full" onClick={() => router.push('/')}>
              홈으로
            </Button>
          </>
        )}

        {unpaidItemCount > 0 && !errorMessage && (
          <p
            className="m-0 mt-4 text-center leading-[1.55]"
            style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
          >
            장바구니의 다른 상품 {unpaidItemCount}개는 아직 결제되지 않았습니다. 장바구니에서 이어서
            결제해 주세요.
          </p>
        )}

        {errorMessage && <ErrorState message={errorMessage} onHome={() => router.push('/')} />}
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[720px] px-4 py-[60px]">
          <p className="m-0 text-center text-base">로딩 중...</p>
        </div>
      }
    >
      <OrderSuccessContent />
    </Suspense>
  );
}
