'use client';

import type { OrderStatus } from '@greenhub/shared';
import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Button, ButtonLabel, ButtonLink } from '@greenhub/ui/components/button';
import { StatusDot, type StatusDotTone } from '@greenhub/ui/components/status-dot';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { type ReactNode, use, useEffect, useId, useState } from 'react';
import OrderDetailExtras from '@/components/benchmark/OrderDetailExtras';
import { LoadingButton } from '@/components/LoadingButton';
import {
  ORDER_STATUS_POLL_INTERVAL_MS,
  ORDER_STATUS_POLL_MAX_MS,
  useOrderStatus,
} from '@/hooks/useOrderStatus';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { formatCancelReason } from '@/lib/order-cancel-reason';
import { formatOrderDeliveryDate } from '@/lib/order-delivery-date';
import {
  ORDER_DETAIL_STALE_MESSAGE,
  orderDetailReadFailureMessage,
} from '@/lib/order-detail-message';
import {
  customerRedeliveryPaymentReturn,
  REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE,
  REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE,
  type RedeliveryPaymentStage,
  redeliveryPaymentFailureMessage,
  redeliveryPaymentUnexpectedFailure,
} from '@/lib/order-redelivery-message';
import { ORDER_STATUS_LABELS as STATUS_LABELS, orderTimelineStepLabel } from '@/lib/order-status';
import { PAYMENT_METHOD_OPTIONS } from '@/lib/payment-method-options';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import {
  buildPaymentRedirectUrl,
  type PaymentRedirectResult,
  parsePaymentRedirectResult,
  readBrowserPaymentContext,
  redeliveryPaymentRedirectPath,
  resolveRedeliveryPaymentReturn,
  shouldRecheckRedeliveryPayment,
} from '@/lib/payment-redirect';
import {
  buildPortonePayMethodRequest,
  type PortonePaymentMethod,
  readPortonePaymentConfiguration,
} from '@/lib/portone-config';
import {
  type CommandOutcome,
  classifyCommandFailure,
  formatDateTime,
  hasAuthoritativeOrderStatus,
  IDLE_COMMAND_OUTCOME,
  isDeliveryHoldActive,
  isNonEmptyString,
  isRecord,
  isSafeIdentifier,
  isStaleOrderRead,
  type OrderDetailView,
  readCommandConfirmation,
  readOrderBenchmarkExtras,
  readOrderDetail,
  readRedeliveryPaymentResponse,
} from './_detail';
import { currentMyPageLoginUrl } from '../../_login';

const API_URL = getApiBaseUrl();
// 취소 요청 뒤 결과를 모를 때(연결 끊김·응답 확인 실패) 보이는 문구. 아래 '상태 다시 확인' 안내와 함께 보인다.
const CANCEL_UNCERTAIN_MESSAGE = '취소가 처리됐는지 아직 확인하지 못했어요.';
// 구매 확정 요청 뒤 결과를 모를 때 보이는 문구. 취소와 같이 '상태 다시 확인' 안내와 함께 보인다.
const REVIEW_UNCERTAIN_MESSAGE = '구매 확정이 처리됐는지 아직 확인하지 못했어요.';

function getTimelineSteps(order: OrderDetailView): OrderStatus[] {
  if (order.saleType === 'group') {
    return ['RECRUITING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
  }
  if (order.deliveryMethod === 'hub') {
    return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP'];
  }
  return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
}

// ① 외형 유지(UI 교체 P5): Mantine Alert(light·radius lg)와 같은 접근성 구조. role=alert, 제목이 있으면
// 제목으로 이름을 붙이고(aria-labelledby), 본문은 aria-describedby로 잇는다.
// Mantine SegmentedControl(fullWidth·size sm·withItemsBorders·theme 기본 반경 16px) 계산값과 DOM.
// 바깥 div role=radiogroup, 항목마다 숨긴 input type=radio(name 공유, id = name-value) + label(htmlFor).
// 바탕 gray-1·안쪽 여백 4px, 글자 15px·600·줄 높이 1.55·좌우 10px·위아래 3px, 기본 gray-7, 고른 항목 검정,
// 고른 항목 아래 흰 면 + shadow-xs(모서리 16 - 4 = 12px), 항목 사이 1px gray-3 구분선(첫 항목·고른 항목 앞뒤는 없음).
// 비활성이면 글자 gray-5·not-allowed. Mantine은 흰 면(FloatingIndicator)을 JS로 고른 항목 위치에 옮기지만,
// 정지 상태의 위치·크기는 고른 항목(label)과 같으므로 그 항목 안의 면으로 그린다.
// 주의: 소비자 globals.css는 Mantine SegmentedControl.css를 불러오지 않아 교체 전 화면은 이 값이 아니라
// 스타일 없는 모양(브라우저 기본 라디오)이었다.
function SegmentedChoice<T extends string>({
  value,
  onChange,
  data,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  data: { value: T; label: string }[];
  disabled?: boolean;
  className?: string;
  'aria-label': string;
}) {
  const name = useId();
  const activeIndex = data.findIndex((item) => item.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-disabled={disabled || undefined}
      className={`relative flex flex-row overflow-hidden rounded-[16px] bg-ui-gray-1 p-1 ${className ?? ''}`}
    >
      {data.map((item, index) => {
        const selected = item.value === value;
        const separator = index > 0 && !selected && index - 1 !== activeIndex;
        const id = `${name}-${item.value}`;
        return (
          <div key={item.value} className="relative z-[2] flex-1">
            {separator && (
              <span aria-hidden className="absolute top-0 bottom-0 left-0 w-px bg-ui-gray-3" />
            )}
            <input
              type="radio"
              name={name}
              value={item.value}
              id={id}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(item.value)}
              className="peer absolute h-0 w-0 overflow-hidden whitespace-nowrap opacity-0"
            />
            <label
              htmlFor={id}
              data-active={(selected && !disabled) || undefined}
              data-disabled={disabled || undefined}
              className={`relative block cursor-pointer overflow-hidden rounded-[12px] px-2.5 py-[3px] text-center text-[15px] leading-[1.55] font-semibold text-ellipsis whitespace-nowrap select-none [-webkit-tap-highlight-color:transparent] peer-focus-visible:outline-2 peer-focus-visible:outline-primary peer-focus-visible:outline-solid ${
                disabled
                  ? 'cursor-not-allowed text-ui-gray-5'
                  : selected
                    ? 'font-bold text-ui-ink'
                    : 'text-ui-gray-7 [@media(hover:hover)]:hover:text-ui-ink'
              }`}
            >
              {selected && (
                <span
                  aria-hidden
                  className="absolute inset-0 z-[-1] rounded-[12px] border-2 border-solid border-[var(--color-text)] bg-background"
                />
              )}
              <span className="relative">{item.label}</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

function DetailAlert({
  variant,
  title,
  className,
  children,
}: {
  variant: 'destructive' | 'warning' | 'secondary';
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <Alert
      variant={variant}
      role="alert"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={bodyId}
      className={className}
    >
      {title && <AlertTitle id={titleId}>{title}</AlertTitle>}
      <AlertDescription id={bodyId}>{children}</AlertDescription>
    </Alert>
  );
}

// Mantine Button variant="transparent" pl={0}(글자 brand light-color, 아이콘과 글자가 한 글자 칸).
function BackButton({ onClick, className }: { onClick: () => void; className: string }) {
  return (
    <Button
      variant="subtle"
      className={`hover:bg-transparent ${className}`}
      style={{ paddingLeft: 0 }}
      onClick={onClick}
    >
      <ButtonLabel>
        <ChevronLeft size={16} /> 뒤로
      </ButtonLabel>
    </Button>
  );
}

// Mantine Stepper(size sm·vertical·color brand) 계산값: 아이콘 36px 원(테두리 2px gray-2, 완료 = 주색 면·흰 체크,
// 진행 = 주색 테두리, 모서리 Mantine과 같은 1000px), 단계 최소 높이 36 + 32 + 5, 단계 사이 5px, 세로 연결선 2px,
// 라벨 15px·600·줄 높이 1. rounded-full(무한대) 모서리와 아래 완료 아이콘 스타일 없이 그렸을 때는 원 가장자리
// 안티앨리어싱이 Mantine과 달랐고, 둘을 Mantine과 같게 둔 뒤 촬영이 같아졌다.
const STEP_OUTLINE = 'var(--ui-gray-2)';
const STEP_COLOR = 'var(--brand)';

function DeliverySteps({ labels, active }: { labels: string[]; active: number }) {
  return (
    <ol className="m-0 flex list-none flex-col flex-nowrap items-start p-0">
      {labels.map((label, index) => {
        const completed = active > index;
        const progress = active === index;
        return (
          <li
            key={label}
            className="mt-[5px] flex min-h-[73px] justify-start overflow-hidden text-base first:mt-0 last:min-h-auto"
          >
            <span className="relative">
              <span
                className="relative flex size-9 min-h-9 min-w-9 items-center justify-center rounded-[1000px] border-2 border-solid font-bold"
                style={{
                  background: completed ? STEP_COLOR : STEP_OUTLINE,
                  borderColor: completed || progress ? STEP_COLOR : STEP_OUTLINE,
                  color: completed ? '#fff' : 'var(--ui-gray-7)',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                {completed ? (
                  // Mantine은 완료 아이콘을 Transition(pop, entered)으로 감싸 아래 스타일이 붙는다.
                  // transform·backface-visibility가 아이콘을 따로 합성하므로 같게 둔다.
                  <span
                    className="absolute inset-0 flex items-center justify-center text-white"
                    style={{
                      WebkitBackfaceVisibility: 'hidden',
                      opacity: 1,
                      transform: 'scale(1)',
                      transformOrigin: 'center center',
                    }}
                  >
                    <svg
                      viewBox="0 0 10 7"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden
                      style={{ width: '60%', height: '60%' }}
                    >
                      <path
                        d="M4 4.586L1.707 2.293A1 1 0 1 0 .293 3.707l3 3a.997.997 0 0 0 1.414 0l5-5A1 1 0 1 0 8.293.293L4 4.586z"
                        fill="currentColor"
                        fillRule="evenodd"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                ) : (
                  <span className="flex">{index + 1}</span>
                )}
              </span>
              {index < labels.length - 1 && (
                <span
                  className="absolute top-[41px] left-[18px] h-screen border-0 border-l-2 border-solid"
                  style={{ borderColor: completed ? STEP_COLOR : STEP_OUTLINE }}
                />
              )}
            </span>
            <span className="ms-3 flex flex-col">
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, lineHeight: 1 }}>
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawOrderId } = use(params);
  const orderId = isSafeIdentifier(rawOrderId) ? rawOrderId : null;
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const accessToken =
    sessionStatus === 'authenticated'
      ? session?.user?.accessToken
      : sessionStatus === 'unauthenticated'
        ? null
        : undefined;
  // 결제 확인 중(PENDING) 주문은 결제 완료 화면처럼 서버에 결제 확인을 요청한다.
  const { order, loading, status, refetch } = useOrderStatus(orderId, accessToken, {
    checkPendingPayment: true,
  });
  const [cancelOutcome, setCancelOutcome] = useState<CommandOutcome>(IDLE_COMMAND_OUTCOME);
  const [reviewOutcome, setReviewOutcome] = useState<CommandOutcome>(IDLE_COMMAND_OUTCOME);
  const [redeliveryOutcome, setRedeliveryOutcome] = useState<CommandOutcome>(IDLE_COMMAND_OUTCOME);
  // 재배송비도 주문 결제와 같은 결제수단 중에서 고른다(카카오페이가 없는 손님도 카드로 낼 수 있게).
  const [redeliveryMethod, setRedeliveryMethod] = useState<PortonePaymentMethod>('kakaopay');
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const detail = orderId ? readOrderDetail(order, orderId) : null;
  const isStaleRead = detail !== null && isStaleOrderRead(status);
  const isAuthoritativelyCancelled = hasAuthoritativeOrderStatus(detail, 'CANCELLED');
  const isAuthoritativelyReviewed = hasAuthoritativeOrderStatus(detail, 'REVIEWED');
  const cancelBusy = cancelOutcome.kind === 'executing' || cancelOutcome.kind === 'reconciling';
  const reviewBusy = reviewOutcome.kind === 'executing' || reviewOutcome.kind === 'reconciling';
  const redeliveryBusy =
    redeliveryOutcome.kind === 'executing' || redeliveryOutcome.kind === 'reconciling';
  const [redeliveryRedirect, setRedeliveryRedirect] = useState<PaymentRedirectResult | null>(null);
  const redeliveryPaid = detail && !isStaleRead ? detail.redeliveryPayment.paid : undefined;

  async function handleRetry() {
    setRetrying(true);
    try {
      await refetch();
    } finally {
      setRetrying(false);
    }
  }

  async function handleCancel() {
    if (!session?.user?.accessToken || !detail?.canRequestCancellation) return;
    if (isAuthoritativelyCancelled) return;
    if (isStaleRead) {
      setActionError(ORDER_DETAIL_STALE_MESSAGE);
      return;
    }
    const message = detail.isRoundOrder
      ? '주문을 취소할까요?'
      : '공동구매 참여를 취소할까요?\n취소하면 되돌릴 수 없어요.';
    if (!confirm(message)) return;
    setCancelOutcome({ kind: 'executing' });
    setActionError(null);
    try {
      let response: Response;
      try {
        response = await fetch(
          `${API_URL}/stores/${encodeURIComponent(detail.storeId)}/orders/${detail.id}/cancel`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.user.accessToken}`,
            },
            body: JSON.stringify({ reason: '고객 요청' }),
          },
        );
      } catch {
        throw {
          kind: 'uncertain',
          message: CANCEL_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = classifyCommandFailure({ httpStatus: response.status, hasResponse: true });
        const serverMessage =
          isRecord(body) && isNonEmptyString(body.message) ? body.message : null;
        if (failure === 'rejected') {
          throw {
            kind: 'rejected',
            message: serverMessage ?? '주문을 취소할 수 없어요.',
          } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
        }
        throw {
          kind: 'uncertain',
          message: CANCEL_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      if (!readCommandConfirmation(body, { orderId: detail.id, status: 'CANCELLED' })) {
        throw {
          kind: 'uncertain',
          message: CANCEL_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      setCancelOutcome({ kind: 'reconciling' });
      const latestOrder = await refetch().catch(() => undefined);
      const latestDetail = latestOrder ? readOrderDetail(latestOrder, detail.id) : null;
      if (latestDetail && hasAuthoritativeOrderStatus(latestDetail, 'CANCELLED')) {
        setCancelOutcome({ kind: 'done' });
        return;
      }
      // Server confirmed the cancel, but the authoritative re-read did not
      // converge. This is not a cancel failure: keep the acknowledgement and
      // ask for an explicit status re-check instead of a blind retry.
      setCancelOutcome({ kind: 'reconcile-failed' });
    } catch (caught) {
      if (isRecord(caught) && typeof caught.message === 'string') {
        if (caught.kind === 'rejected') {
          setCancelOutcome({ kind: 'rejected', message: caught.message });
          setActionError(caught.message);
          return;
        }
        if (caught.kind === 'uncertain') {
          setCancelOutcome({ kind: 'uncertain', message: caught.message });
          setActionError(caught.message);
          return;
        }
      }
      // 그 밖의 예외도 내부 오류 글자 대신 같은 고객 문구로 상태 확인을 안내한다.
      setCancelOutcome({ kind: 'uncertain', message: CANCEL_UNCERTAIN_MESSAGE });
      setActionError(CANCEL_UNCERTAIN_MESSAGE);
    }
  }

  async function handleRedeliveryPayment() {
    const fee = detail?.deliveryHold?.redeliveryFee;
    if (
      !session?.user?.accessToken ||
      !detail?.redeliveryPayment.canPay ||
      detail.redeliveryPayment.requiresRecovery ||
      typeof fee !== 'number' ||
      fee <= 0
    ) {
      return;
    }
    if (isStaleRead) {
      setActionError(ORDER_DETAIL_STALE_MESSAGE);
      return;
    }
    setRedeliveryOutcome({ kind: 'executing' });
    setActionError(null);
    // 예상하지 못한 예외가 결제창을 열기 전인지 뒤인지 가르기 위해 진행 단계를 적어 둔다.
    let stage: RedeliveryPaymentStage = 'requesting';
    try {
      let response: Response;
      try {
        response = await fetch(
          `${API_URL}/stores/${encodeURIComponent(detail.storeId)}/orders/${detail.id}/redelivery-fee`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.user.accessToken}`,
            },
            body: JSON.stringify({ idempotencyKey: `redelivery:${detail.id}:first` }),
          },
        );
      } catch {
        throw {
          kind: 'uncertain',
          message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = classifyCommandFailure({ httpStatus: response.status, hasResponse: true });
        const serverMessage =
          isRecord(body) && isNonEmptyString(body.message) ? body.message : null;
        if (failure === 'rejected') {
          throw {
            kind: 'rejected',
            message: serverMessage ?? '재배송비 결제를 시작할 수 없어요.',
          } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
        }
        throw {
          kind: 'uncertain',
          message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      const payment = readRedeliveryPaymentResponse(body, {
        orderId: detail.id,
        storeId: detail.storeId,
        amount: fee,
      });
      if (payment.status === 'FAILED' || payment.status === 'REFUNDED') {
        throw {
          kind: 'rejected',
          message: REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
      }
      if (payment.status === 'PENDING') {
        // 결제 설정 읽기·결제 모듈 불러오기는 결제창을 열기 전이라 실패해도 결제가 시작되지 않는다.
        stage = 'opening-window';
        const configuration = readPortonePaymentConfiguration(redeliveryMethod);
        const PortOne = await import('@portone/browser-sdk/v2');
        const browser = readBrowserPaymentContext();
        const redirectUrl = browser
          ? buildPaymentRedirectUrl(browser.origin, redeliveryPaymentRedirectPath(detail.id))
          : null;
        // 여기부터는 결제창이 열려 손님이 결제했을 수 있다.
        stage = 'paying';
        const result = await PortOne.requestPayment({
          storeId: configuration.portoneStoreId,
          paymentId: payment.paymentId,
          orderName: payment.name,
          totalAmount: payment.amount,
          currency: 'KRW',
          channelKey: configuration.channelKey,
          ...buildPortonePayMethodRequest(configuration.paymentMethod, {
            name: session.user.name,
          }),
          ...(redirectUrl ? { redirectUrl } : {}),
        });
        if (result && 'code' in result) {
          // PG 원문 코드·메시지는 화면에 쓰지 않고 고객 문구로 바꾼다.
          throw {
            kind: 'rejected',
            message: redeliveryPaymentFailureMessage(result),
          } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
        }
      }

      stage = 'confirming';
      setRedeliveryOutcome({ kind: 'reconciling' });
      const latestOrder = await refetch().catch(() => undefined);
      const latestDetail = latestOrder ? readOrderDetail(latestOrder, detail.id) : null;
      if (!latestDetail?.redeliveryPayment.paid) {
        throw {
          kind: 'uncertain',
          message: REDELIVERY_PAYMENT_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      setRedeliveryOutcome({ kind: 'done' });
    } catch (caught) {
      if (isRecord(caught) && typeof caught.message === 'string') {
        if (caught.kind === 'rejected') {
          setRedeliveryOutcome({ kind: 'rejected', message: caught.message });
          setActionError(caught.message);
          return;
        }
        if (caught.kind === 'uncertain') {
          setRedeliveryOutcome({ kind: 'uncertain', message: caught.message });
          setActionError(caught.message);
          return;
        }
      }
      // 그 밖의 예외는 내부 오류 글자 대신 고객 문구로 보인다. 결제창을 열기 전(결제 설정 누락·결제 모듈
      // 불러오기 실패)이면 '시작하지 못했어요'로 다시 시도를, 그 뒤(응답 확인 실패·결제창 오류·완료 확인)면
      // 결제됐을 수 있으므로 '확인하지 못했어요'와 상태 다시 확인을 안내한다.
      const outcome = redeliveryPaymentUnexpectedFailure(stage);
      setRedeliveryOutcome(outcome);
      setActionError(outcome.message);
    }
  }

  // 모바일 재배송비 결제는 같은 탭 리다이렉트로 이 주문 상세에 돌아온다. 결과 쿼리는 한 번만 읽고 지운다.
  useEffect(() => {
    const result = parsePaymentRedirectResult(new URLSearchParams(window.location.search));
    if (result.kind === 'none') return;
    setRedeliveryRedirect(result);
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  // 성공 쿼리여도 서버 redeliveryPayment.paid(웹훅 반영)를 확인할 때만 완료로 본다.
  useEffect(() => {
    if (!redeliveryRedirect) return;
    // 복귀 쿼리의 PG 원문은 화면에 쓰지 않는다. 판정은 그대로 두고 문구만 고객 문구로 바꾼다.
    const outcome = customerRedeliveryPaymentReturn(
      redeliveryRedirect,
      resolveRedeliveryPaymentReturn(redeliveryRedirect, redeliveryPaid),
    );
    if (outcome.kind === 'none') {
      setRedeliveryRedirect(null);
      return;
    }
    if (outcome.kind === 'reconciling') {
      setRedeliveryOutcome({ kind: 'reconciling' });
      return;
    }
    if (outcome.kind === 'done') {
      setRedeliveryOutcome({ kind: 'done' });
      setActionError(null);
      setRedeliveryRedirect(null);
      return;
    }
    setRedeliveryOutcome(outcome);
    setActionError(outcome.message);
    // 실패·취소는 확정이다. 성공 쿼리인데 아직 미확인이면 아래 재확인으로 paid가 올 때까지 계속 본다.
    if (outcome.kind === 'rejected') setRedeliveryRedirect(null);
  }, [redeliveryRedirect, redeliveryPaid]);

  // 성공으로 돌아왔는데 서버 결제 확인(웹훅) 전이면 3초마다 다시 읽는다(최대 2분).
  // 주문 상태 자동 확인은 결제 대기(PENDING) 주문만 하므로 보류·준비 중 주문은 여기서 따로 본다.
  const awaitingRedeliveryPaid = shouldRecheckRedeliveryPayment(
    redeliveryRedirect,
    redeliveryPaid,
    0,
    ORDER_STATUS_POLL_MAX_MS,
  );
  useEffect(() => {
    if (!awaitingRedeliveryPaid) return;
    const startedAt = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 다시 읽기가 끝난 뒤에만 다음 확인을 예약한다(요청이 겹치지 않는다).
    const scheduleRecheck = () => {
      if (
        stopped ||
        Date.now() - startedAt + ORDER_STATUS_POLL_INTERVAL_MS >= ORDER_STATUS_POLL_MAX_MS
      ) {
        return;
      }
      timer = setTimeout(() => {
        void refetch().finally(scheduleRecheck);
      }, ORDER_STATUS_POLL_INTERVAL_MS);
    };
    scheduleRecheck();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [awaitingRedeliveryPaid, refetch]);

  async function handleConfirm() {
    if (!session?.user?.accessToken || !detail) return;
    if (isAuthoritativelyReviewed) return;
    if (isStaleRead) {
      setActionError(ORDER_DETAIL_STALE_MESSAGE);
      return;
    }
    setReviewOutcome({ kind: 'executing' });
    setActionError(null);
    try {
      let response: Response;
      try {
        response = await fetch(
          `${API_URL}/stores/${encodeURIComponent(detail.storeId)}/orders/${detail.id}/review`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.user.accessToken}`,
            },
          },
        );
      } catch {
        throw {
          kind: 'uncertain',
          message: REVIEW_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = classifyCommandFailure({ httpStatus: response.status, hasResponse: true });
        const serverMessage =
          isRecord(body) && isNonEmptyString(body.message) ? body.message : null;
        if (failure === 'rejected') {
          throw {
            kind: 'rejected',
            message: serverMessage ?? '구매 확정을 하지 못했어요.',
          } satisfies Extract<CommandOutcome, { kind: 'rejected' }>;
        }
        throw {
          kind: 'uncertain',
          message: REVIEW_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      if (!readCommandConfirmation(body, { orderId: detail.id, status: 'REVIEWED' })) {
        throw {
          kind: 'uncertain',
          message: REVIEW_UNCERTAIN_MESSAGE,
        } satisfies Extract<CommandOutcome, { kind: 'uncertain' }>;
      }
      setReviewOutcome({ kind: 'reconciling' });
      const latestOrder = await refetch().catch(() => undefined);
      const latestDetail = latestOrder ? readOrderDetail(latestOrder, detail.id) : null;
      if (latestDetail && hasAuthoritativeOrderStatus(latestDetail, 'REVIEWED')) {
        setReviewOutcome({ kind: 'done' });
        return;
      }
      // Server confirmed the review, but the authoritative re-read did not
      // converge. This is not a review failure: keep the acknowledgement and
      // ask for an explicit status re-check instead of a blind retry.
      setReviewOutcome({ kind: 'reconcile-failed' });
    } catch (caught) {
      if (isRecord(caught) && typeof caught.message === 'string') {
        if (caught.kind === 'rejected') {
          setReviewOutcome({ kind: 'rejected', message: caught.message });
          setActionError(caught.message);
          return;
        }
        if (caught.kind === 'uncertain') {
          setReviewOutcome({ kind: 'uncertain', message: caught.message });
          setActionError(caught.message);
          return;
        }
      }
      // 그 밖의 예외도 내부 오류 글자 대신 같은 고객 문구로 상태 확인을 안내한다.
      setReviewOutcome({ kind: 'uncertain', message: REVIEW_UNCERTAIN_MESSAGE });
      setActionError(REVIEW_UNCERTAIN_MESSAGE);
    }
  }

  if (sessionStatus === 'loading' || (loading && !detail && status === 'loading')) {
    return (
      <div className="py-[60px] text-center">
        <p className="m-0 text-base" style={{ color: 'var(--color-text-secondary)' }}>
          로딩 중...
        </p>
      </div>
    );
  }

  if (sessionStatus === 'unauthenticated' || status === 'auth') {
    // 로그인하지 않은 손님만 로그인으로 보낸다. 로그인한 채 거절(401/403, 남의 주문 등)되면 로그인 화면이
    // 활성 세션을 복귀 주소(이 주문)로 곧바로 돌려보내 버튼이 아무 일도 하지 않는 것처럼 보이므로 목록만 둔다.
    const needsLogin = sessionStatus === 'unauthenticated';
    return (
      <div className="mx-auto max-w-[720px] px-4 py-5">
        <BackButton className="mb-4" onClick={() => router.push('/mypage')} />
        <div className="flex flex-col items-center justify-start gap-3 py-10">
          <p className="m-0 text-center text-sm" style={{ color: 'var(--color-danger)' }}>
            {needsLogin
              ? '로그인이 필요해요. 로그인하면 이 주문으로 돌아와요.'
              : '이 주문을 볼 수 없어요. 내 주문 목록에서 다시 골라 주세요.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {needsLogin && (
              <LoadingButton onClick={() => router.push(currentMyPageLoginUrl())} loading={retrying}>
                로그인
              </LoadingButton>
            )}
            <Button variant="outline" onClick={() => router.push('/mypage')}>
              주문 목록으로 돌아가기
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!orderId || status === 'not-found') {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-5">
        <BackButton className="mb-4" onClick={() => router.push('/mypage')} />
        <div className="flex flex-col items-center justify-start gap-3 py-10">
          <p className="m-0 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            찾을 수 없는 주문이에요. 주문 번호를 확인하거나 주문 목록으로 돌아가 주세요.
          </p>
          <Button variant="outline" onClick={() => router.push('/mypage')}>
            주문 목록으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  if (!detail && (status === 'network' || status === 'server')) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-5">
        <BackButton className="mb-4" onClick={() => router.push('/mypage')} />
        <div className="flex flex-col items-center justify-start gap-3 py-10">
          <p className="m-0 text-center text-sm" style={{ color: 'var(--color-danger)' }}>
            {orderDetailReadFailureMessage(status)}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <LoadingButton onClick={handleRetry} loading={retrying} disabled={retrying}>
              다시 시도
            </LoadingButton>
            <Button variant="outline" onClick={() => router.push('/mypage')}>
              주문 목록으로 돌아가기
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    if (loading) {
      return (
        <div className="py-[60px] text-center">
          <p className="m-0 text-base" style={{ color: 'var(--color-text-secondary)' }}>
            로딩 중...
          </p>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-[720px] px-4 py-5">
        <BackButton className="mb-4" onClick={() => router.push('/mypage')} />
        <div className="flex flex-col items-center justify-start gap-3 py-10">
          <p className="m-0 text-center text-sm" style={{ color: 'var(--color-danger)' }}>
            주문 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <LoadingButton onClick={handleRetry} loading={retrying} disabled={retrying}>
              다시 시도
            </LoadingButton>
            <Button variant="outline" onClick={() => router.push('/mypage')}>
              주문 목록으로 돌아가기
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isCancelled = isAuthoritativelyCancelled || cancelOutcome.kind === 'done';
  const cancelReasonText = formatCancelReason(detail.cancelReason);
  // 배송 예정일은 '11월 10일(화)'(한국 시간)로 보인다. 형식을 읽지 못한 드문 값만 날짜 부분을 그대로 둔다.
  const deliveryDateText = detail.requestedDeliveryDate
    ? (formatOrderDeliveryDate(detail.requestedDeliveryDate) ??
      detail.requestedDeliveryDate.slice(0, 10))
    : null;
  const showCancelReconcileWarning =
    !isAuthoritativelyCancelled && cancelOutcome.kind === 'reconcile-failed';
  const showCancelCommand =
    detail.canRequestCancellation && !isAuthoritativelyCancelled && cancelOutcome.kind !== 'done';
  const isReviewable =
    !isAuthoritativelyReviewed &&
    (detail.status === 'DELIVERED' || detail.status === 'PICKED_UP') &&
    reviewOutcome.kind !== 'done';
  const showReviewConfirmed = isAuthoritativelyReviewed || reviewOutcome.kind === 'done';
  const showReviewSection = isReviewable || reviewOutcome.kind !== 'idle' || showReviewConfirmed;
  const showReviewReconcileWarning =
    !isAuthoritativelyReviewed && reviewOutcome.kind === 'reconcile-failed';
  const reviewLabel = showReviewConfirmed
    ? '구매 확정 완료'
    : reviewOutcome.kind === 'reconciling'
      ? '상태 확인 중...'
      : reviewOutcome.kind === 'reconcile-failed'
        ? '구매 확정 확인 필요'
        : reviewOutcome.kind === 'executing'
          ? '구매 확정 중...'
          : '구매 확정';
  const needsStatusRecheck =
    cancelOutcome.kind === 'uncertain' ||
    cancelOutcome.kind === 'reconcile-failed' ||
    reviewOutcome.kind === 'uncertain' ||
    reviewOutcome.kind === 'reconcile-failed' ||
    redeliveryOutcome.kind === 'uncertain';
  const showPickupCode =
    detail.pickupCode && ['HUB_ARRIVED', 'PICKED_UP', 'REVIEWED'].includes(detail.status);
  const steps = getTimelineSteps(detail);
  const currentStep =
    detail.status === 'REVIEWED' ? steps.length : Math.max(0, steps.indexOf(detail.status));
  const paymentIsDone = detail.redeliveryPayment.paid;
  // 배송 보류·취소는 문제 상태라 빨강 계열 배지로 보인다
  // ② 방향(design-standard §5): 상태는 점 + 글자. 배송 보류=빨강, 취소·결제 대기·완료=회색, 나머지 검정.
  const statusTone: StatusDotTone =
    detail.status === 'DELIVERY_HELD'
      ? 'problem'
      : detail.status === 'CANCELLED' ||
          detail.status === 'PENDING' ||
          detail.status === 'DELIVERED' ||
          detail.status === 'REVIEWED'
        ? 'done'
        : 'default';

  return (
    // ① 외형 유지(UI 교체 P5): Mantine Container(sm·px md·pt lg·pb 80)·Paper·Group·Stack·Text·Title·Alert·
    // Divider·Image·Stepper 계산값.
    <div className="mx-auto max-w-[720px] px-4 pt-5 pb-20">
      <BackButton className="mb-3" onClick={() => router.push('/mypage')} />
      {(status === 'network' || status === 'server') && (
        <DetailAlert variant="warning" className="mb-5" title="최신 정보를 불러오지 못했어요">
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-sm">{orderDetailReadFailureMessage(status)}</p>
            <p className="m-0 text-sm">보이는 정보가 최신이 아닐 수 있어요.</p>
            <p className="m-0 text-sm">
              최신 상태를 확인하기 전까지 취소·구매 확정·재배송비 결제를 시작할 수 없어요.
            </p>
            <LoadingButton
              className="mt-2.5"
              variant="outline"
              loading={retrying}
              disabled={retrying}
              onClick={handleRetry}
            >
              {' '}
              다시 시도{' '}
            </LoadingButton>
          </div>
        </DetailAlert>
      )}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className="m-0 leading-[1.3]"
            style={{ fontSize: 22, fontWeight: 'var(--fw-extrabold)', letterSpacing: '-0.01em' }}
          >
            주문 상세
          </h1>
          <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            주문번호: {detail.orderNumber}
          </p>
        </div>
        {/* 접근성 트리의 문단(p)을 유지한다. */}
        <p className="m-0 shrink-0 leading-[1.55]">
          <StatusDot tone={statusTone} className="font-extrabold">
            {STATUS_LABELS[detail.status]}
          </StatusDot>
        </p>
      </div>

      <div
        className="mb-5 p-4"
        style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
          <p className="m-0 text-base" style={{ fontWeight: 'var(--fw-extrabold)' }}>
            주문 상품
          </p>
          {detail.items.length > 0 && (
            <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              총 {detail.items.length}개 상품 ·{' '}
              {detail.items.reduce((sum, item) => sum + item.quantity, 0)}개
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          {detail.items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-start justify-between gap-4">
              <p className="m-0 text-sm">
                {item.productName} × {item.quantity}
              </p>
              <p className="m-0 text-sm">{item.subtotalAmount.toLocaleString('ko-KR')}원</p>
            </div>
          ))}
          {/* Mantine Divider(gray-3 1px 위 테두리, 구분선 역할) */}
          <hr className="m-0 h-0 border-0 border-t border-solid border-ui-gray-3" />
          {detail.deliveryFee > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                배송비
              </p>
              <p className="m-0 text-sm">{detail.deliveryFee.toLocaleString('ko-KR')}원</p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="m-0 text-base" style={{ fontWeight: 'var(--fw-bold)' }}>
              결제 금액
            </p>
            <p
              className="m-0 leading-[1.55]"
              style={{
                fontSize: 20,
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 'var(--fw-extrabold)',
              }}
            >
              {detail.totalAmount.toLocaleString('ko-KR')}원
            </p>
          </div>
        </div>
      </div>

      {/* 벤치마킹 비교 기능(옵션·선물 표시, 후기, 관리 안내, 다시 주문) */}
      <OrderDetailExtras
        orderId={detail.id}
        storeId={detail.storeId}
        status={detail.status}
        isRoundOrder={detail.isRoundOrder}
        items={detail.items}
        extras={readOrderBenchmarkExtras(order)}
      />

      <div className="mb-5 rounded-[var(--radius)] bg-[var(--color-surface-muted)] p-4">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              배송 방식
            </p>
            <p className="m-0 text-sm" style={{ fontWeight: 'var(--fw-bold)' }}>
              {detail.deliveryMethod === 'hub'
                ? '거점 픽업'
                : detail.deliveryMethod === 'parcel'
                  ? '택배'
                  : '직배송'}
              {detail.saleType === 'group' && ' (공동구매)'}
            </p>
          </div>
          {detail.deliveryAddress && (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                배송지
              </p>
              <p className="m-0 text-right text-sm">
                {detail.deliveryAddress.address} {detail.deliveryAddress.addressDetail}
              </p>
            </div>
          )}
          {deliveryDateText && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                배송 예정일
              </p>
              <p className="m-0 text-sm">{deliveryDateText}</p>
            </div>
          )}
        </div>
      </div>

      {detail.deliveryHold && isDeliveryHoldActive(detail) && (
        <DetailAlert variant="destructive" className="mb-5" title="배송 보류">
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-sm">{detail.deliveryHold.reasonMessage}</p>
            <p className="m-0 text-sm">
              고객 책임: {detail.deliveryHold.customerResponsible ? '해당' : '없음'}
            </p>
            {detail.deliveryHold.redeliveryFee !== null && (
              <p className="m-0 text-sm">
                재배송비: {detail.deliveryHold.redeliveryFee.toLocaleString('ko-KR')}원
              </p>
            )}
            {detail.deliveryHold.nextContactAt && (
              <p className="m-0 text-sm">
                다음 연락: {formatDateTime(detail.deliveryHold.nextContactAt)}
              </p>
            )}
            {detail.deliveryHold.nextDeliveryAt && (
              <p className="m-0 text-sm">
                다음 배송: {formatDateTime(detail.deliveryHold.nextDeliveryAt)}
              </p>
            )}
            {detail.redeliveryPayment.required && (
              <div className="mt-2.5 flex flex-col gap-1.5">
                {paymentIsDone && (
                  <p className="m-0 text-sm" style={{ fontWeight: 'var(--fw-bold)' }}>
                    재배송비 결제가 완료됐어요. 배송이 다시 시작되기를 기다리고 있어요.
                  </p>
                )}
                {!paymentIsDone && detail.redeliveryPayment.requiresRecovery && (
                  <p className="m-0 text-sm" style={{ color: 'var(--color-danger)' }}>
                    {REDELIVERY_PAYMENT_NEEDS_SUPPORT_MESSAGE}
                  </p>
                )}
                {!paymentIsDone &&
                  !detail.redeliveryPayment.requiresRecovery &&
                  detail.redeliveryPayment.canPay && (
                    <>
                      {PAYMENT_METHOD_OPTIONS.length > 1 && (
                        <SegmentedChoice
                          className="mt-2.5"
                          aria-label="재배송비 결제 수단"
                          value={redeliveryMethod}
                          onChange={(value) => setRedeliveryMethod(value as PortonePaymentMethod)}
                          disabled={redeliveryBusy || isStaleRead}
                          data={PAYMENT_METHOD_OPTIONS.map(({ method, label }) => ({
                            value: method,
                            label,
                          }))}
                        />
                      )}
                      <LoadingButton
                        className="mt-2.5"
                        variant="destructive"
                        loading={redeliveryBusy}
                        disabled={redeliveryBusy || isStaleRead}
                        onClick={handleRedeliveryPayment}
                      >
                        {redeliveryOutcome.kind === 'reconciling'
                          ? '결제 확인 중...'
                          : detail.redeliveryPayment.status === 'PENDING'
                            ? '재배송비 결제 계속하기'
                            : '재배송비 결제'}
                      </LoadingButton>
                    </>
                  )}
              </div>
            )}
          </div>
        </DetailAlert>
      )}

      {detail.deliveryPhotoUrl && (
        <div className="mb-5 rounded-[var(--radius)] bg-[var(--color-surface-muted)] p-4">
          <p className="m-0 mb-3 text-sm" style={{ fontWeight: 'var(--fw-bold)' }}>
            배송 완료 사진
          </p>
          {/* Mantine Image(radius lg·fit cover·mah 420): 블록·폭 100%·flex 0 */}
          {/* biome-ignore lint/performance/noImgElement: Mantine Image와 같은 img 요소를 그린다 */}
          <img
            src={detail.deliveryPhotoUrl}
            alt="배송 완료 사진"
            className="block w-full flex-[0] rounded-lg object-cover"
            style={{ maxHeight: 420 }}
          />
        </div>
      )}

      {showPickupCode && (
        <div className="mb-5 rounded-[var(--radius)] bg-[var(--color-surface-muted)] p-5 text-center">
          <p className="m-0 text-sm" style={{ fontWeight: 'var(--fw-bold)', color: 'var(--brand-ink)' }}>
            픽업 코드
          </p>
          <p
            className="m-0 leading-[1.55]"
            style={{
              fontSize: 36,
              fontFamily: 'monospace',
              fontWeight: 'var(--fw-bold)',
              letterSpacing: 8,
            }}
          >
            {detail.pickupCode}
          </p>
          <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            코드를 제시하고 수령하세요
          </p>
        </div>
      )}

      {showCancelCommand && (
        <DetailAlert
          variant="secondary"
          className="mb-5"
          title={detail.isRoundOrder ? '주문 마감 전 취소' : '공동구매 모집 중'}
        >
          <p className="m-0 mb-3 text-sm">
            {detail.isRoundOrder
              ? '주문 마감 전까지 취소할 수 있어요. 결제한 수단으로 환불돼요.'
              : '모집 중인 공동구매 참여를 취소할 수 있어요.'}
          </p>
          {isStaleRead && <p className="m-0 mb-3 text-sm">{ORDER_DETAIL_STALE_MESSAGE}</p>}
          {cancelOutcome.kind === 'reconciling' && (
            <p className="m-0 mb-3 text-sm">취소가 접수됐어요. 최신 주문 상태를 확인하고 있어요.</p>
          )}
          <LoadingButton
            className="w-full"
            variant="outline-destructive"
            loading={cancelBusy}
            disabled={cancelBusy || isStaleRead || cancelOutcome.kind === 'reconcile-failed'}
            onClick={handleCancel}
          >
            {detail.isRoundOrder ? '주문 취소' : '공동구매 참여 취소'}
          </LoadingButton>
        </DetailAlert>
      )}

      {showCancelReconcileWarning && (
        <DetailAlert variant="warning" className="mb-5" title="취소 확인됨 · 상태 재확인 필요">
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-sm">
              취소는 접수됐지만 최신 주문 화면을 다시 불러오지 못했어요. 취소 실패가 아니니 바로
              다시 취소하지 말고 아래 ‘다시 시도’를 눌러 상태를 확인해 주세요.
            </p>
            <LoadingButton
              className="mt-2.5"
              variant="outline"
              loading={retrying}
              disabled={retrying}
              onClick={handleRetry}
            >
              {' '}
              다시 시도{' '}
            </LoadingButton>
          </div>
        </DetailAlert>
      )}

      {isCancelled && (
        <DetailAlert variant="destructive" className="mb-5 text-center">
          <p className="m-0 text-base" style={{ fontWeight: 'var(--fw-bold)' }}>
            주문이 취소됐어요
          </p>
          {cancelReasonText && <p className="m-0 text-sm">사유: {cancelReasonText}</p>}
        </DetailAlert>
      )}

      {actionError && (
        <DetailAlert variant="destructive" className="mb-5">
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-sm">{actionError}</p>
            {needsStatusRecheck && (
              <p className="m-0 text-sm">다시 요청하기 전에 아래 ‘상태 다시 확인’을 눌러 주세요.</p>
            )}
            {needsStatusRecheck && (
              <LoadingButton
                className="mt-2.5"
                variant="outline"
                loading={retrying}
                disabled={retrying}
                onClick={handleRetry}
              >
                {' '}
                상태 다시 확인{' '}
              </LoadingButton>
            )}
          </div>
        </DetailAlert>
      )}

      {showReviewSection && (
        <div className="mb-5 flex flex-col gap-1.5">
          <LoadingButton
            className="w-full"
            disabled={
              reviewBusy || showReviewConfirmed || showReviewReconcileWarning || isStaleRead
            }
            loading={reviewBusy}
            variant={showReviewConfirmed ? 'outline' : 'default'}
            onClick={handleConfirm}
          >
            {reviewLabel}
          </LoadingButton>
          {isStaleRead && isReviewable && (
            <p className="m-0 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {ORDER_DETAIL_STALE_MESSAGE}
            </p>
          )}
          {reviewOutcome.kind === 'reconciling' && (
            <p className="m-0 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              구매 확정이 접수됐어요. 최신 주문 상태를 확인하고 있어요.
            </p>
          )}
        </div>
      )}

      {showReviewReconcileWarning && (
        <DetailAlert variant="warning" className="mb-5" title="구매 확정 확인됨 · 상태 재확인 필요">
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-sm">
              구매 확정은 접수됐지만 최신 주문 화면을 다시 불러오지 못했어요. 확정 실패가 아니니 바로
              다시 확정하지 말고 아래 ‘다시 시도’를 눌러 상태를 확인해 주세요.
            </p>
            <LoadingButton
              className="mt-2.5"
              variant="outline"
              loading={retrying}
              disabled={retrying}
              onClick={handleRetry}
            >
              {' '}
              다시 시도{' '}
            </LoadingButton>
          </div>
        </DetailAlert>
      )}

      {!isCancelled && detail.status !== 'DELIVERY_HELD' && (
        <div>
          <p className="m-0 mb-4 text-sm" style={{ fontWeight: 'var(--fw-bold)' }}>
            배송 현황
          </p>
          <DeliverySteps
            active={currentStep}
            labels={steps.map(orderTimelineStepLabel)}
          />
        </div>
      )}

      {/* 문의하기: 공개 사업자 정보의 고객센터 전화. 주문번호를 함께 보여 통화 때 말하기 쉽게 한다. */}
      <div
        className="mt-5 rounded-[var(--radius)] bg-[var(--color-surface-muted)] p-4"
        data-testid="order-support"
      >
        <p className="m-0 text-base" style={{ fontWeight: 'var(--fw-extrabold)' }}>
          문의하기
        </p>
        <p className="m-0 mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          전화하실 때 아래 주문번호를 알려 주세요.
        </p>
        <p className="m-0 mt-1 text-sm" style={{ fontWeight: 'var(--fw-bold)' }}>
          주문번호 {detail.orderNumber}
        </p>
        <p className="m-0 mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          상담 시간 {PUBLIC_BUSINESS_INFO.supportHours}
        </p>
        <ButtonLink className="mt-3 w-full" variant="outline" href={PUBLIC_BUSINESS_INFO.phoneHref}>
          전화로 문의하기 {PUBLIC_BUSINESS_INFO.phone}
        </ButtonLink>
      </div>
    </div>
  );
}
