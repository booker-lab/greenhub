'use client';

import type { RedeliveryPaymentActionability } from '@greenhub/shared';
import { apiPathSegment, readRouteParam } from '@greenhub/shared';
import { toast } from '@greenhub/ui/components/toast';
import { cn } from '@greenhub/ui/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { type ReactNode, use, useCallback, useEffect, useRef, useState } from 'react';
import { AppButton } from '@/components/app-button';
import { TOAST_WARNING } from '@/components/app-toaster';
import { text } from '@/components/look';
import { Spinner } from '@/components/spinner';
import { apiFetch, apiRead } from '@/lib/api';
import { isApiTimeoutError } from '@/lib/api-timeout';
import { splitDeliveryAddress } from '@/lib/address-parts';
import { type DriverOrderItem, orderItemLines, orderItemsLabel } from '@/lib/order-quantity';
import { buildOrderMapLink } from '../../map/_lib/map-navigation-link';
import {
  buildDriverOrderDetailScope,
  classifyDriverOrderCommandError,
  type DriverOrderReadback,
  type DriverOrderReadErrorKind,
  isDriverHoldEntryVisible,
  isDriverOrderCommandAllowed,
  isDriverOrderCommandContinuationCurrent,
  isDriverOrderStatusAck,
  isDriverTerminalCommandStatus,
  readDriverOrderCommandErrorCodeFromResponse,
  resolveDriverStatusCommandReadback,
  shouldPreserveDriverOrderOnReadError,
  toDriverOrderNetworkError,
  toDriverOrderReadError,
} from '../_lib/driver-order-detail';
import {
  getRedeliveryPaymentPresentation,
  isDeliveryStartAllowed,
} from '../_lib/redelivery-payment';
import {
  type DeliveryHold,
  DeliveryHoldModal,
  HOLD_REASON_LABEL,
  HOLD_UNCERTAIN_READBACK_WARNING,
} from './_components/DeliveryHoldModal';

type Order = {
  id?: string;
  schemaVersion?: number;
  roundId?: string | null;
  storeId: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  deliveryAddress?: { address?: string };
  hubName?: string;
  hubAddress?: string;
  productName?: string;
  quantity?: number;
  items?: DriverOrderItem[];
  preparedAt?: string | null;
  updatedAt?: string | null;
  sellerPhone?: string;
  buyerPhone?: string;
  requestNote?: string | null;
  deliveryHold?: DeliveryHold | null;
  redeliveryPayment?: RedeliveryPaymentActionability;
};

const METHOD_LABEL: Record<string, string> = {
  direct: '직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

// STATUS ACK-uncertain convergence contract (NO_RESEND + AUTHORITATIVE_GET).
// B(2xx malformed) / C(ACK mismatch) / F(other 4xx) / G(5xx) / H(network) 모두
// 같은 PATCH를 자동 재전송하지 않고 authoritative GET으로 수렴한다.
// "다시 시도해주세요" 같은 same-command resend 유도 copy를 쓰지 않는다.
const STATUS_UNCERTAIN_CONVERGENCE_MESSAGE =
  '명령이 처리되었는지 확실하지 않습니다. 최신 상태를 다시 확인합니다.';
const STATUS_UNCERTAIN_READBACK_WARNING =
  '명령 결과를 확인하지 못했습니다. 상태를 다시 확인해 주세요. 같은 명령을 바로 다시 보내지 마세요.';
// 시간 초과(apiFetch 기본 제한, lib/api-timeout.ts)도 같은 ACK-uncertain 수렴을 따른다.
const STATUS_TIMEOUT_CONVERGENCE_MESSAGE =
  '서버 응답이 늦어 처리되었는지 확실하지 않습니다. 최신 상태를 다시 확인합니다.';
// 불확실 수렴 뒤 fresh GET 판정(resolveDriverStatusCommandReadback) 결과 안내.
const STATUS_APPLIED_AFTER_UNCERTAIN_MESSAGE = '처리된 것을 확인했습니다.';
// 서버는 이미 적용된 같은 전이를 403/409 STATE_CONFLICT로 거절하므로 다시 눌러도 두 번 처리되지 않는다.
const STATUS_NOT_APPLIED_AFTER_UNCERTAIN_MESSAGE =
  '아직 처리되지 않았습니다. 다시 눌러도 두 번 처리되지 않습니다.';
const STATUS_LEFT_SCOPE_AFTER_UNCERTAIN_MESSAGE =
  '주문이 진행 목록에서 빠졌습니다. 목록에서 결과를 확인해 주세요.';

export default function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId: rawOrderId } = use(params);
  // 경로 파라미터는 형식을 검사한 원래 ID로 읽는다. 맞지 않으면 주문 요청을 보내지 않는다.
  const orderId = readRouteParam(rawOrderId);
  if (!orderId) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="flex flex-col items-center gap-3 px-4">
          <p className={cn(text, 'text-center')} style={{ color: 'var(--driver-text-muted)' }}>
            주문 주소가 올바르지 않습니다. 배송 목록에서 주문을 다시 선택해 주세요.
          </p>
          <Link
            href="/board"
            replace
            className={cn(text, 'cursor-pointer no-underline hover:underline')}
            style={{ color: 'var(--color-primary-dark)', fontSize: 'var(--font-size-sm)' }}
          >
            배송 목록으로
          </Link>
        </div>
      </div>
    );
  }
  return <OrderDetail orderId={orderId} />;
}

function OrderDetail({ orderId }: { orderId: string }) {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [holdOpened, setHoldOpened] = useState(false);
  const [readLoading, setReadLoading] = useState(true);
  const [readRefreshing, setReadRefreshing] = useState(false);
  const [readError, setReadError] = useState<{
    kind: DriverOrderReadErrorKind;
    message: string;
  } | null>(null);
  // readback 실패는 command 실패와 분리한다: ACK된 명령은 재전송하지 않고 상태 재확인만 안내한다.
  const [readbackWarning, setReadbackWarning] = useState<string | null>(null);
  const [readKey, setReadKey] = useState(0);
  const readSeqRef = useRef(0);
  const commandSeqRef = useRef(0);
  const hasOrderRef = useRef(false);
  // detail scope: order identity + user id + role + access token.
  // orderId·auth scope가 바뀌면 이전 scope의 order/PII를 절대 남기지 않는다.
  const readScopeRef = useRef<string | null>(null);
  // render 중 동기 갱신되는 live scope: command continuation이 effect 실행 전
  // 전환도 감지할 수 있도록 현재 principal을 항상 반영한다.
  const liveScopeRef = useRef<string | null>(null);
  liveScopeRef.current = buildDriverOrderDetailScope({
    orderId,
    userId: session?.user.id,
    role: session?.user.role,
    token: session?.user.accessToken,
  });
  // C1: status command dispatch의 실제 authority. loading UI state와 분리된 ref 기반
  // in-flight guard이며, React state의 비동기 반영만으로는 막을 수 없는 동일 frame
  // double-click/double-submit에서도 두 번째 PATCH dispatch를 차단한다.
  const inFlightRef = useRef(false);

  const readDetail = useCallback(
    async (token: string, signal?: AbortSignal): Promise<DriverOrderReadback> => {
      readSeqRef.current += 1;
      const seq = readSeqRef.current;
      const isCurrent = () => seq === readSeqRef.current;
      const background = hasOrderRef.current;
      if (background) {
        setReadRefreshing(true);
      } else {
        setReadLoading(true);
      }
      setReadError(null);
      let readback: DriverOrderReadback;
      try {
        const response = await apiRead(`/driver/orders/${encodeURIComponent(orderId)}`, token, {
          signal,
        });
        if (!isCurrent()) return { kind: 'stale' };
        if (!response.ok) {
          const failure = toDriverOrderReadError(response.status);
          // AUTH_ERROR·NOT_FOUND는 authority loss/absence이므로 이전 order를 즉시 제거한다.
          // FETCH_ERROR만 일시적 refresh 실패로 이전 내용을 stale로 유지할 수 있다.
          if (shouldPreserveDriverOrderOnReadError(failure.kind, hasOrderRef.current)) {
            setReadError({ kind: failure.kind, message: failure.message });
          } else {
            hasOrderRef.current = false;
            setOrder(null);
            setReadError({ kind: failure.kind, message: failure.message });
            setReadbackWarning(null);
          }
          readback = { kind: 'error', errorKind: failure.kind };
        } else {
          const payload = (await response.json()) as Order;
          if (!isCurrent()) return { kind: 'stale' };
          hasOrderRef.current = true;
          setOrder(payload);
          setReadError(null);
          // fresh authoritative read는 이전 readback 불확실성을 해소한다.
          setReadbackWarning(null);
          readback = { kind: 'order', status: payload.status };
        }
      } catch (cause: unknown) {
        // effect 정리로 취소된 조회(AbortError)는 사용자 오류로 표시하지 않는다.
        if (
          !isCurrent() ||
          signal?.aborted ||
          (cause instanceof DOMException && cause.name === 'AbortError')
        ) {
          return { kind: 'stale' };
        }
        // 시간 초과(ApiTimeoutError)는 AbortError가 아니므로 여기서 FETCH_ERROR로 수렴한다.
        const failure = toDriverOrderNetworkError();
        if (!hasOrderRef.current) setOrder(null);
        setReadError({ kind: failure.kind, message: failure.message });
        readback = { kind: 'error', errorKind: failure.kind };
      }
      if (!isCurrent()) return { kind: 'stale' };
      setReadLoading(false);
      setReadRefreshing(false);
      return readback;
    },
    [orderId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: readKey is an intentional manual-refresh trigger, orderId/readDetail stay explicit for readability
  useEffect(() => {
    const token = session?.user.accessToken;
    if (!token) {
      // usable token 없음을 not-found/empty로 표시하지 않는다.
      // token 상실·session loading 역시 authority loss이므로 이전 scope 잔여물을 모두 제거한다.
      // 이전 scope에서 시작된 command continuation도 scope/sequence 무효화로 차단한다.
      readSeqRef.current += 1;
      commandSeqRef.current += 1;
      inFlightRef.current = false;
      // stale command loading은 새 scope 소유자가 직접 해제한다: stale finally는
      // 새 scope를 덮지 않도록 guard되므로 여기서 해제하지 않으면 leaking된다.
      setLoading(false);
      readScopeRef.current = buildDriverOrderDetailScope({
        orderId,
        userId: session?.user.id,
        role: session?.user.role,
        token,
      });
      setOrder(null);
      hasOrderRef.current = false;
      setReadError({ kind: 'AUTH_ERROR', message: '로그인 정보를 다시 확인해 주세요.' });
      setReadbackWarning(null);
      setReadLoading(false);
      setReadRefreshing(false);
      return;
    }
    const nextScope = buildDriverOrderDetailScope({
      orderId,
      userId: session?.user.id,
      role: session?.user.role,
      token,
    });
    if (readScopeRef.current !== nextScope) {
      // orderId 또는 user/role/token scope 변경: 이전 주문·PII·readError/readback을
      // 새 scope에 남기지 않는다. 진행 중이던 이전 scope read는 seq 무효화로,
      // 이전 scope command는 command sequence 무효화로 덮어쓰기를 막는다.
      readSeqRef.current += 1;
      commandSeqRef.current += 1;
      inFlightRef.current = false;
      // orderId·user/role/token 전환도 새 scope가 command loading을 소유하고 해제한다.
      setLoading(false);
      readScopeRef.current = nextScope;
      hasOrderRef.current = false;
      setOrder(null);
      setReadError(null);
      setReadbackWarning(null);
      setReadLoading(true);
      setReadRefreshing(false);
    }
    // 화면을 떠나거나 orderId·세션이 바뀌면 진행 중인 조회를 취소한다. 순번 가드는 그대로 둔다.
    const controller = new AbortController();
    void readDetail(token, controller.signal);
    return () => controller.abort();
  }, [
    orderId,
    session?.user.id,
    session?.user.role,
    session?.user.accessToken,
    sessionStatus,
    readKey,
    readDetail,
  ]);

  async function updateStatus(status: string) {
    // C1: dispatch 직전에 ref를 선점한다. 이미 진행 중인 command가 있으면
    // 두 번째 PATCH를 dispatch하지 않고 즉시 복귀한다.
    if (inFlightRef.current) return;
    if (!order || !session) return;
    // fail-closed: stale read confidence에서는 위험 command를 실행하지 않는다.
    // AUTH/NOT_FOUND는 원칙적으로 order가 제거된 상태이며, FETCH stale·readback 미확인도 차단한다.
    if (
      !isDriverOrderCommandAllowed({
        hasOrder: order !== null,
        readErrorKind: readError?.kind ?? null,
        hasReadbackWarning: readbackWarning !== null,
      })
    ) {
      return;
    }
    const token = session.user.accessToken;
    commandSeqRef.current += 1;
    const cmdSeq = commandSeqRef.current;
    const cmdScope = buildDriverOrderDetailScope({
      orderId,
      userId: session.user.id,
      role: session.user.role,
      token,
    });
    const cmdOrderId = orderId;
    const isCommandCurrent = () =>
      cmdOrderId === liveScopeRef.current?.split('::')[0] &&
      isDriverOrderCommandContinuationCurrent({
        snapshotSeq: cmdSeq,
        snapshotScope: cmdScope,
        currentSeq: commandSeqRef.current,
        currentScope: liveScopeRef.current,
      });
    // ACK-uncertain 수렴(authoritative GET) 결과로 마무리한다. 같은 PATCH는 자동 재전송하지 않는다.
    // 이미 전이됐으면 성공으로, 반영 안 됐으면 fresh 상태 그대로 다시 누를 수 있게 둔다.
    // 조회 실패면 readDetail이 남긴 FETCH_ERROR·불확실 경고로 fail-closed를 유지한다.
    const settleUncertainReadback = (readback: DriverOrderReadback) => {
      if (!isCommandCurrent()) return;
      const result = resolveDriverStatusCommandReadback({ requestedStatus: status, readback });
      if (result === 'APPLIED') {
        toast.add({ description: STATUS_APPLIED_AFTER_UNCERTAIN_MESSAGE });
        if (isDriverTerminalCommandStatus(status)) router.replace('/board?tab=delivering');
        return;
      }
      if (result === 'LEFT_DRIVER_SCOPE') {
        // 완료 전이 요청 뒤 상세 404: 완료 ACK 경로와 같이 목록 조회로 수렴한다.
        toast.add({
          type: TOAST_WARNING,
          description: STATUS_LEFT_SCOPE_AFTER_UNCERTAIN_MESSAGE,
        });
        router.replace('/board?tab=delivering');
        return;
      }
      if (result === 'NOT_APPLIED') {
        toast.add({
          type: TOAST_WARNING,
          description: STATUS_NOT_APPLIED_AFTER_UNCERTAIN_MESSAGE,
        });
      }
    };
    inFlightRef.current = true;
    setLoading(true);
    setReadbackWarning(null);
    try {
      const res = await apiFetch(
        `/stores/${apiPathSegment(order.storeId)}/orders/${apiPathSegment(orderId)}/status`,
        token,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      );
      if (!isCommandCurrent()) return;
      if (!res.ok) {
        // 401은 envelope code와 무관하게 authority loss다. body 파싱 없이 즉시
        // protected order/PII/command authority를 clear하고 AUTH_ERROR로 수렴한다.
        if (res.status === 401) {
          hasOrderRef.current = false;
          setOrder(null);
          setReadError({
            kind: 'AUTH_ERROR',
            message: '로그인 정보를 다시 확인해 주세요.',
          });
          setReadbackWarning(null);
          return;
        }
        // error-code aware command recovery: envelope code를 안전하게 읽는다.
        // body 파싱 실패는 null이며 그 자체가 same-command resend를 유도하지 않는다.
        const errorCode = await readDriverOrderCommandErrorCodeFromResponse(res);
        if (!isCommandCurrent()) return;
        const recovery = classifyDriverOrderCommandError({
          status: res.status,
          code: errorCode,
        });
        // 403 AUTHORITY + unknown/missing-code 403 fail-closed authority loss.
        // 이전 protected order/PII를 유지하는 흐름을 남기지 않는다.
        if (recovery === 'AUTHORITY_LOSS') {
          hasOrderRef.current = false;
          setOrder(null);
          setReadError({
            kind: 'AUTH_ERROR',
            message: '로그인 정보를 다시 확인해 주세요.',
          });
          setReadbackWarning(null);
          return;
        }
        // 403/409 + STATE_CONFLICT: 로그인 상실이 아니다. 같은 command를 자동
        // 재전송하지 않고 authoritative GET으로 수렴한다 (기존 409 race convergence 재사용).
        if (recovery === 'STATE_CONFLICT') {
          toast.add({
            type: TOAST_WARNING,
            description: '이미 상태가 변경되었을 수 있습니다. 최신 상태를 다시 확인합니다.',
          });
          await readDetail(token);
          return;
        }
        // DRIVER_ORDER_NOT_FOUND: authoritative absence/hiding. 이전 protected
        // order를 신뢰하지 않고 NOT_FOUND 의미로 수렴한다. 자동 resend 없음.
        if (recovery === 'NOT_FOUND') {
          hasOrderRef.current = false;
          setOrder(null);
          setReadError({
            kind: 'NOT_FOUND',
            message: '주문을 찾을 수 없습니다',
          });
          setReadbackWarning(null);
          return;
        }
        // F/G: 403/409 STATE·AUTHORITY·NOT_FOUND 이외 4xx·5xx ACK-uncertain.
        // 같은 PATCH를 자동 재전송하지 않고 UNCERTAIN을 보존한 채 authoritative
        // GET으로 수렴한다. fresh GET 성공이 warning을 해소하기 전에는 fail-closed다.
        toast.add({
          type: TOAST_WARNING,
          description: STATUS_UNCERTAIN_CONVERGENCE_MESSAGE,
        });
        setReadbackWarning(STATUS_UNCERTAIN_READBACK_WARNING);
        settleUncertainReadback(await readDetail(token));
        return;
      }
      // B: 2xx이지만 malformed JSON 등으로 ACK 파싱 불가. 자동 resend 없이 GET 수렴한다.
      let result: { orderId?: unknown; status?: unknown };
      try {
        result = (await res.json()) as { orderId?: unknown; status?: unknown };
      } catch {
        if (!isCommandCurrent()) return;
        toast.add({
          type: TOAST_WARNING,
          description: STATUS_UNCERTAIN_CONVERGENCE_MESSAGE,
        });
        setReadbackWarning(STATUS_UNCERTAIN_READBACK_WARNING);
        settleUncertainReadback(await readDetail(token));
        return;
      }
      if (!isCommandCurrent()) return;
      // C: 2xx이지만 ACK orderId/status mismatch. 자동 resend 없이 GET 수렴한다.
      if (!isDriverOrderStatusAck(result, orderId, status)) {
        toast.add({
          type: TOAST_WARNING,
          description: STATUS_UNCERTAIN_CONVERGENCE_MESSAGE,
        });
        setReadbackWarning(STATUS_UNCERTAIN_READBACK_WARNING);
        settleUncertainReadback(await readDetail(token));
        return;
      }
      const isTerminal = status === 'DELIVERED' || status === 'HUB_ARRIVED';
      // ACK 성공 직후 local 합성 없이 authoritative GET으로 수렴한다. 자동 resend는 하지 않는다.
      try {
        const reread = await apiRead(`/driver/orders/${encodeURIComponent(orderId)}`, token);
        if (!isCommandCurrent()) return;
        if (!reread.ok) throw toDriverOrderReadError(reread.status);
        const fresh = (await reread.json()) as Order;
        if (!isCommandCurrent()) return;
        hasOrderRef.current = true;
        setOrder(fresh);
        setReadError(null);
        setReadbackWarning(null);
      } catch (readbackCause: unknown) {
        if (!isCommandCurrent()) return;
        // readback 단계의 AUTH_ERROR·NOT_FOUND 역시 authority loss이므로 이전 order를 남기지 않는다.
        const readbackKind = (readbackCause as { kind?: unknown } | null)?.kind;
        if (readbackKind === 'AUTH_ERROR' || readbackKind === 'NOT_FOUND') {
          const message =
            readbackCause instanceof Error ? readbackCause.message : '주문을 찾을 수 없습니다';
          hasOrderRef.current = false;
          setOrder(null);
          setReadError({
            kind: readbackKind as DriverOrderReadErrorKind,
            message,
          });
          setReadbackWarning(null);
          if (!isTerminal) return;
        } else if (isTerminal) {
          // terminal은 board가 fresh fetch하므로 navigation 계약을 유지한다.
        } else {
          const message =
            readbackCause instanceof Error
              ? '처리는 완료되었지만 최신 상태를 확인하지 못했습니다. 다시 확인해 주세요.'
              : '처리는 완료되었지만 최신 상태를 확인하지 못했습니다. 다시 확인해 주세요.';
          setReadbackWarning(message);
          return;
        }
      }
      if (isTerminal) {
        if (!isCommandCurrent()) return;
        router.replace('/board?tab=delivering');
      }
    } catch (cause: unknown) {
      // H: network/transport error·시간 초과 등 PATCH ACK-uncertain. 같은 PATCH를 자동 재전송하지
      // 않고 UNCERTAIN을 보존한 채 authoritative GET으로 수렴한다. same-command 재시도 유도 copy 금지.
      // 시간 초과는 서버가 상태를 저장한 뒤 알림 발송을 기다리는 중일 수 있어 이미 처리됐을 수 있다.
      if (!isCommandCurrent()) return;
      toast.add({
        type: TOAST_WARNING,
        description: isApiTimeoutError(cause)
          ? STATUS_TIMEOUT_CONVERGENCE_MESSAGE
          : STATUS_UNCERTAIN_CONVERGENCE_MESSAGE,
      });
      setReadbackWarning(STATUS_UNCERTAIN_READBACK_WARNING);
      settleUncertainReadback(await readDetail(token));
    } finally {
      // 모든 종료 경로에서 in-flight를 해제한다. 401/403 authority-clear return,
      // 409 convergence return, readback 분기 return, throw 모두 여기를 거친다.
      // 이전 command의 finally가 새 scope의 command/loading 상태를 덮지 않도록
      // 동일 generation + 동일 scope일 때만 해제한다.
      // biome-ignore lint/correctness/noUnsafeFinally: 지난 명령의 오류는 새 화면 상태로 올리지 않고 여기서 끝낸다.
      if (!isCommandCurrent()) return;
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  if (readLoading) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spinner />
      </div>
    );
  }

  if (!order) {
    const message =
      readError?.kind === 'AUTH_ERROR'
        ? '로그인 정보를 다시 확인해 주세요.'
        : readError?.kind === 'FETCH_ERROR'
          ? '주문 정보를 불러오지 못했습니다'
          : '주문을 찾을 수 없습니다';
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <p className={text} style={{ color: 'var(--driver-text-muted)' }}>
            {message}
          </p>
          {readError?.kind === 'FETCH_ERROR' && (
            <AppButton tone="brand-outline" onClick={() => setReadKey((key) => key + 1)}>
              다시 시도
            </AppButton>
          )}
          {readError?.kind === 'AUTH_ERROR' && (
            // 같은 토큰으로 재조회해도 401/403이 반복되므로 세션을 정리하고 로그인으로 보낸다.
            <AppButton tone="brand-outline" onClick={() => void signOut({ redirectTo: '/login' })}>
              다시 로그인
            </AppButton>
          )}
        </div>
      </div>
    );
  }

  const isDelivering = order.status === 'DELIVERING';
  const isPreparing = order.status === 'PREPARING';
  const isHeld = order.status === 'DELIVERY_HELD';
  const isHub = order.deliveryMethod === 'hub';
  // 소비자 이름은 넣지 않고 주소(거점은 거점 주소)만으로 외부 지도 링크를 만든다.
  const mapLink = buildOrderMapLink({
    deliveryMethod: order.deliveryMethod,
    // 상세 주소(동·호수)가 붙지 않은 기본 주소가 있으면 그것으로 검색한다.
    address: order.deliveryAddress?.address ?? order.address,
    hubName: order.hubName,
    hubAddress: order.hubAddress,
  });
  const isRoundDirect =
    order.schemaVersion === 2 && Boolean(order.roundId) && order.deliveryMethod === 'direct';
  const paymentPresentation = getRedeliveryPaymentPresentation(order.redeliveryPayment);
  const deliveryStartAllowed = isDeliveryStartAllowed(order.redeliveryPayment);
  const itemLines = orderItemLines(order.items);
  // 서버가 반드시 허용하는 상태(본인 배정 DELIVERING)에서만 보류 진입을 노출한다.
  const holdEntryVisible = isDriverHoldEntryVisible({ status: order.status, isRoundDirect });
  // stale FETCH_ERROR 또는 readback 미확인 상태의 order는 최신 authoritative state가 아니다.
  // 위험 command 진입(상태 변경·사진 촬영·보류)은 fail-closed로 비활성화한다.
  const commandsAllowed = isDriverOrderCommandAllowed({
    hasOrder: true,
    readErrorKind: readError?.kind ?? null,
    hasReadbackWarning: readbackWarning !== null,
  });
  // 문 앞에서 가장 중요한 동·호수를 크게 쓴다. 거점은 거점 이름이 제목이고 주소가 보조다.
  const addressParts = isHub
    ? { base: order.hubAddress ?? '-', detail: order.hubName ?? null }
    : (splitDeliveryAddress(order.address, order.deliveryAddress?.address) ?? {
        base: '-',
        detail: null,
      });
  // 단계마다 보이는 전화는 하나다(판매자: 수거 대기·거점 배송 중, 소비자: 직배송 배송 중·보류). 노출 규칙은 API가 정한다.
  const contact =
    isPreparing && order.sellerPhone
      ? { label: '판매자', phone: order.sellerPhone }
      : (isDelivering || isHeld) && !isHub && order.buyerPhone
        ? { label: '소비자', phone: order.buyerPhone }
        : isDelivering && isHub && order.sellerPhone
          ? { label: '판매자', phone: order.sellerPhone }
          : null;
  const preparedAtStr = order.preparedAt
    ? new Date(order.preparedAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '시간 미정';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* 머리: 뒤로 + 배송 방식·상태 글자. 틀은 흰 바탕·검정 글자, 문제 상태만 빨강(design-direction.md §6). */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg)',
          padding: '4px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="-ml-2.5 flex size-11 cursor-pointer appearance-none items-center justify-center border-0 bg-transparent p-0 no-underline"
          style={{ color: 'var(--color-text)' }}
          aria-label="뒤로가기"
        >
          <svg
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <p className={text} style={mutedText}>
            {METHOD_LABEL[order.deliveryMethod] ?? order.deliveryMethod}
          </p>
          {isPreparing && (
            <p className={text} style={mutedText}>
              · 수거 {preparedAtStr}
            </p>
          )}
          {isDelivering && (
            <p
              className={text}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              배송 중
            </p>
          )}
          {isHeld && (
            <p
              className={cn(text, 'flex items-center gap-1.5')}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-danger)',
              }}
            >
              <span
                aria-hidden="true"
                className="block size-2 rounded-full"
                style={{ backgroundColor: 'var(--color-danger)' }}
              />
              배송 보류
            </p>
          )}
        </div>
      </header>

      {/* 본문 */}
      <main style={{ flex: 1, padding: '8px 16px 24px' }}>
        <div className="flex flex-col gap-5">
          {readRefreshing && (
            <p className={text} style={mutedText}>
              최신 정보를 확인하는 중입니다…
            </p>
          )}
          {readError && (
            <ProblemPanel>
              <p className={text} style={problemText}>
                {readError.message} (이전 정보 표시 중)
              </p>
              {readError.kind === 'FETCH_ERROR' && (
                <AppButton tone="brand-outline" onClick={() => setReadKey((key) => key + 1)}>
                  다시 확인
                </AppButton>
              )}
            </ProblemPanel>
          )}
          {readbackWarning && (
            <ProblemPanel>
              <p className={text} style={problemText}>
                {readbackWarning}
              </p>
              <AppButton
                tone="brand-outline"
                onClick={() => {
                  const token = session?.user.accessToken;
                  if (token) void readDetail(token);
                }}
              >
                상태 다시 확인
              </AppButton>
            </ProblemPanel>
          )}

          {/* 동·호수가 주인공: 위 15px 기본 주소, 아래 28px 동·호수(거점은 거점 이름). */}
          <div className="flex flex-col gap-1">
            <p className={text} style={mutedText}>
              {addressParts.detail ? addressParts.base : isHub ? '거점' : '배송지'}
            </p>
            <h1
              className="m-0"
              style={{
                fontSize: addressParts.detail ? 28 : 'var(--font-size-xl)',
                fontWeight: 'var(--fw-extrabold)',
                lineHeight: 1.3,
                color: 'var(--color-text)',
                wordBreak: 'keep-all',
                overflowWrap: 'anywhere',
              }}
            >
              {addressParts.detail ?? addressParts.base}
            </h1>
          </div>

          {/* 건넬 상품을 크게 + 받는 분 */}
          <div className="flex flex-col gap-1">
            {itemLines ? (
              <ItemLines lines={itemLines} />
            ) : (
              <ItemLines lines={[orderItemsLabel(order.productName, order.quantity)]} />
            )}
            <p className={text} style={mutedText}>
              받는 분 {order.buyerName ?? '-'}
            </p>
          </div>

          {order.requestNote?.trim() && (
            <div
              className="flex flex-col gap-0.5 rounded-[var(--radius)] p-4"
              style={{ backgroundColor: 'var(--color-surface-muted)' }}
            >
              <p className={text} style={mutedText}>
                요청사항
              </p>
              <p
                className={text}
                style={{
                  color: 'var(--color-text)',
                  fontWeight: 'var(--fw-bold)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {order.requestNote.trim()}
              </p>
            </div>
          )}

          {/* 전화·길 찾기: 연회색 면 + 검정 글자(초록 주요 버튼만 칠한 면이 되게). */}
          {(contact || mapLink) && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {contact && (
                  <a
                    href={`tel:${contact.phone}`}
                    className={actionButton}
                    style={actionButtonStyle}
                  >
                    <PhoneIcon />
                    {contact.label}에게 전화
                  </a>
                )}
                {mapLink && (
                  <a
                    href={mapLink.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={actionButton}
                    style={actionButtonStyle}
                  >
                    카카오맵에서 {mapLink.kind === 'route' ? '길찾기' : '주소 보기'}
                  </a>
                )}
              </div>
              {contact && (
                <p className={text} style={{ ...mutedText, fontVariantNumeric: 'tabular-nums' }}>
                  {contact.label} {contact.phone}
                </p>
              )}
            </div>
          )}

          {/* 배송 보류 같은 드문 작업은 주요 버튼에서 떨어진 글자 버튼에서 확인 창과 함께 연다. */}
          {holdEntryVisible && (
            <button
              type="button"
              className="m-0 min-h-11 cursor-pointer appearance-none self-start border-0 bg-transparent p-0 underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
              disabled={loading || !commandsAllowed}
              onClick={() => setHoldOpened(true)}
            >
              부재·문제 알리기
            </button>
          )}

          {isHeld && order.deliveryHold && <DeliveryHoldCard hold={order.deliveryHold} />}

          {paymentPresentation && (
            <div
              className="flex flex-col gap-1 rounded-[var(--radius)] p-4"
              style={{
                backgroundColor:
                  paymentPresentation.color === 'red'
                    ? 'var(--color-danger-surface)'
                    : 'var(--color-surface-muted)',
              }}
            >
              <p
                className={cn(text, 'flex items-center gap-1.5')}
                style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
              >
                <span
                  aria-hidden="true"
                  className="block size-2 rounded-full"
                  style={{
                    backgroundColor:
                      paymentPresentation.color === 'red'
                        ? 'var(--color-danger)'
                        : 'var(--color-text)',
                  }}
                />
                {paymentPresentation.label}
              </p>
              <p className={text} style={{ ...mutedText, color: 'var(--color-text)' }}>
                재배송비 결제 · {paymentPresentation.description}
              </p>
            </div>
          )}
        </div>
      </main>

      {/* 주요 행동 하나만 엄지 영역에 고정: 높이 56px·화면 폭 전체, 위쪽은 고정 바 그림자. */}
      {(isHeld && isRoundDirect) ||
      ((isPreparing || isDelivering) && isRoundDirect) ||
      (isPreparing && !isRoundDirect) ||
      (isDelivering && !isRoundDirect) ? (
        <div
          style={{
            position: 'sticky',
            bottom: 'calc(72px + env(safe-area-inset-bottom))',
            padding: '12px 16px',
            backgroundColor: 'var(--color-bg)',
            boxShadow: 'var(--driver-bar-shadow)',
          }}
        >
          {isHeld &&
            isRoundDirect &&
            (deliveryStartAllowed ? (
              <AppButton
                fullWidth
                size="xl"
                loading={loading}
                disabled={loading || !commandsAllowed}
                onClick={() => updateStatus('DELIVERING')}
              >
                배송 재개
              </AppButton>
            ) : (
              <AppButton fullWidth size="xl" tone="gray" disabled>
                {paymentPresentation?.label ?? '배송 재개 불가'}
              </AppButton>
            ))}
          {isPreparing &&
            isRoundDirect &&
            (deliveryStartAllowed ? (
              <AppButton
                fullWidth
                size="xl"
                loading={loading}
                disabled={loading || !commandsAllowed}
                onClick={() => updateStatus('DELIVERING')}
              >
                수거 완료 / 배송 시작
              </AppButton>
            ) : (
              <AppButton fullWidth size="xl" tone="gray" disabled>
                {paymentPresentation?.label ?? '배송 시작 불가'}
              </AppButton>
            ))}
          {isDelivering && isRoundDirect && (
            <AppButton
              fullWidth
              size="xl"
              loading={loading}
              disabled={!commandsAllowed}
              onClick={() =>
                router.push(`/board/${encodeURIComponent(orderId)}/photo/round-direct`)
              }
            >
              도착 사진 찍고 완료
            </AppButton>
          )}
          {isPreparing &&
            !isRoundDirect &&
            (deliveryStartAllowed ? (
              <AppButton
                fullWidth
                size="xl"
                loading={loading}
                disabled={loading || !commandsAllowed}
                onClick={() => updateStatus('DELIVERING')}
              >
                수거 완료 / 배송 시작
              </AppButton>
            ) : (
              <AppButton fullWidth size="xl" tone="gray" disabled>
                {paymentPresentation?.label ?? '배송 시작 불가'}
              </AppButton>
            ))}
          {isDelivering && !isHub && !isRoundDirect && (
            <AppButton
              fullWidth
              size="xl"
              loading={loading}
              disabled={loading || !commandsAllowed}
              onClick={() => updateStatus('DELIVERED')}
            >
              배송 완료
            </AppButton>
          )}
          {isDelivering && isHub && (
            <AppButton
              fullWidth
              size="xl"
              loading={loading}
              disabled={!commandsAllowed}
              onClick={() => router.push(`/board/${encodeURIComponent(orderId)}/photo`)}
            >
              거점 도착
            </AppButton>
          )}
        </div>
      ) : null}

      {isRoundDirect && (
        <DeliveryHoldModal
          opened={holdOpened}
          loading={loading}
          orderId={orderId}
          storeId={order.storeId}
          orderStatus={order.status}
          onClose={() => setHoldOpened(false)}
          onLoading={setLoading}
          onSaved={() => {
            const token = session?.user.accessToken;
            if (token) void readDetail(token);
          }}
          onConvergence={() => {
            const token = session?.user.accessToken;
            if (token) void readDetail(token);
          }}
          onUncertainConvergence={() => {
            // HOLD ACK-uncertain: 같은 HOLD를 자동 재전송하지 않고 parent authoritative GET으로
            // 수렴한다. fresh GET 성공이 warning을 해소하기 전에는 fail-closed로 같은 HOLD와
            // 다른 위험 command를 차단하고, manual recovery는 GET(상태 다시 확인)이다.
            setReadbackWarning(HOLD_UNCERTAIN_READBACK_WARNING);
            const token = session?.user.accessToken;
            if (token) void readDetail(token);
          }}
          onAuthorityLoss={() => {
            // HOLD 401 / 403 + AUTHORITY_DENIED: modal 내부 표시에 그치지 않고
            // parent가 protected order/PII를 즉시 제거하고 AUTH_ERROR로 수렴하며
            // modal을 reset/close한다. 같은 hold 자동 resend 금지.
            hasOrderRef.current = false;
            setOrder(null);
            setReadError({
              kind: 'AUTH_ERROR',
              message: '로그인 정보를 다시 확인해 주세요.',
            });
            setReadbackWarning(null);
            setHoldOpened(false);
          }}
          onNotFound={() => {
            // HOLD DRIVER_ORDER_NOT_FOUND: authoritative absence/hiding.
            // 이전 protected order를 신뢰하지 않고 NOT_FOUND 의미로 수렴한다.
            hasOrderRef.current = false;
            setOrder(null);
            setReadError({
              kind: 'NOT_FOUND',
              message: '주문을 찾을 수 없습니다',
            });
            setReadbackWarning(null);
            setHoldOpened(false);
          }}
        />
      )}
    </div>
  );
}

function DeliveryHoldCard({ hold }: { hold: DeliveryHold }) {
  const fee =
    typeof hold.redeliveryFee === 'number' && hold.redeliveryFee > 0
      ? `${hold.redeliveryFee.toLocaleString('ko-KR')}원`
      : '없음';
  return (
    <ProblemPanel>
      <p className={text} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
        배송 보류 내용
      </p>
      <InfoRow label="보류 유형" value={HOLD_REASON_LABEL[hold.reasonCode]} />
      <InfoRow label="보류 사유" value={hold.reasonMessage} />
      <InfoRow label="책임" value={hold.customerResponsible ? '고객 책임' : '판매자 책임'} />
      <InfoRow label="재배송비" value={fee} />
      {hold.nextContactAt && (
        <InfoRow label="다음 연락" value={formatSchedule(hold.nextContactAt)} />
      )}
      {hold.nextDeliveryAt && (
        <InfoRow label="새 배송 예정" value={formatSchedule(hold.nextDeliveryAt)} />
      )}
    </ProblemPanel>
  );
}

function formatSchedule(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 기사 ② 글자 값(design-direction.md §6): 보조 글자도 15px·거의 검정, 문제 글자는 빨강.
const mutedText = { fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' } as const;
const problemText = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--color-text)',
} as const;
const actionButton =
  'flex min-h-12 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-center no-underline';
const actionButtonStyle = {
  backgroundColor: 'var(--driver-action-surface)',
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--fw-bold)',
  lineHeight: 1.3,
  // 좁은 폭(360px)에서 "주소 보기"가 글자 단위로 끊기지 않게 단어 단위로 줄을 바꾼다.
  wordBreak: 'keep-all',
} as const;

/** 문제 상태 면: 테두리 없이 빨강 연한 면, 글자는 검정(빨강 글자는 이 면 위 대비가 4.1:1이라 쓰지 않는다). */
function ProblemPanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-2.5 rounded-[var(--radius)] p-4"
      style={{ backgroundColor: 'var(--color-danger-surface)' }}
    >
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <p className={text} style={mutedText}>
        {label}
      </p>{' '}
      <p
        className={cn(text, 'text-right')}
        style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)', maxWidth: '60%' }}
      >
        {value}
      </p>
    </div>
  );
}

// 건넬 상품: 상품마다 한 줄, 20px 굵게.
function ItemLines({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col">
      {lines.map((line, index) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: 줄은 받은 순서 그대로 고정 — reorder 없음
          key={index}
          className={text}
          style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--fw-bold)',
            lineHeight: 1.4,
            color: 'var(--color-text)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
      />
    </svg>
  );
}
