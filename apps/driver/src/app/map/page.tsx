'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { apiRead } from '@/lib/api';
import { inFlightPhotoOrderIds } from '@/lib/delivering-groups';
import {
  buildDriverListScope,
  shouldPreserveDriverListOnReadError,
  toDriverListReadError,
  toDriverListReadErrorKind,
} from '@/lib/driver-list-read';
import { buildOrderMapLink, pickNextDeliveryStop } from './_lib/map-navigation-link';
import {
  countHeldOrders,
  groupMapStops,
  isMapStop,
  mapStopAddressLine,
} from './_lib/map-stop-groups';
import { cn } from '@greenhub/ui/lib/utils';
import { usePendingPhotos } from '@/app/board/[orderId]/photo/pending-photo-client';
import {
  type PendingPhotoBadgeKind,
  pendingPhotoBadgeKind,
} from '@/app/board/[orderId]/photo/pending-photo-policy';
import { AppButton } from '@/components/app-button';
import { text, titleH4 } from '@/components/look';
import { PendingPhotoBadge } from '@/components/pending-photo-notice';

type Order = {
  id: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  // 동·호수 없는 기본 주소. 지도 링크가 주소 검색에 쓴다(map-navigation-link).
  deliveryAddress?: { address?: string };
  hubName?: string;
  hubAddress?: string;
  // 요청한 기사 본인에게 배정된 주문인지. 이전 API 응답에는 없다(수거 대기 묶음 나누기에 쓴다).
  assignedToMe?: boolean;
  lat?: number;
  lng?: number;
};

function nearestNeighbor(orders: Order[]): Order[] {
  if (orders.length <= 1) return orders;
  const visited = new Set<string>();
  const result: Order[] = [];
  let current = orders[0];
  result.push(current);
  visited.add(current.id);

  while (result.length < orders.length) {
    let nearest: Order | null = null;
    let minDist = Infinity;
    for (const o of orders) {
      if (visited.has(o.id)) continue;
      if (!o.lat || !o.lng || !current.lat || !current.lng) {
        nearest = o;
        break;
      }
      const dist = Math.hypot(o.lat - current.lat, o.lng - current.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = o;
      }
    }
    if (!nearest) break;
    result.push(nearest);
    visited.add(nearest.id);
    current = nearest;
  }
  return result;
}

export default function MapPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasSuccessfulRead, setHasSuccessfulRead] = useState(false);
  const requestIdRef = useRef(0);
  const hasSuccessfulReadRef = useRef(false);
  // user identity + role + access token scope가 바뀌면 이전 scope의
  // protected route를 새 fetch 완료 전에 동기적으로 제거한다.
  const listScopeRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is an intentional manual-refresh trigger for the error-state retry button
  useEffect(() => {
    if (sessionStatus === 'loading') return;

    const token = session?.user.accessToken;
    if (!token) {
      // usable token 없음을 0건 성공으로 표시하지 않는다. 보호된 stale도 유지하지 않는다.
      // 다음 인증된 조회가 initial loading으로 시작하도록 성공 기억도 초기화한다.
      requestIdRef.current += 1;
      listScopeRef.current = '__no_token__';
      hasSuccessfulReadRef.current = false;
      setOrders([]);
      setHasSuccessfulRead(false);
      setAuthRequired(true);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const nextScope = buildDriverListScope({
      userId: session?.user.id,
      role: session?.user.role,
      token,
    });
    if (listScopeRef.current !== nextScope) {
      // user/token scope 변경: 새 fetch 완료를 기다리지 않고 이전 scope의
      // protected route·성공 기록·error/freshness를 동기적으로 제거한다.
      // 진행 중이던 이전 scope read는 sequence 무효화로 덮어쓰기를 막는다.
      requestIdRef.current += 1;
      listScopeRef.current = nextScope;
      hasSuccessfulReadRef.current = false;
      setOrders([]);
      setHasSuccessfulRead(false);
      setError(null);
      setAuthRequired(false);
      setLoading(true);
      setRefreshing(false);
    }

    const controller = new AbortController();
    let active = true;
    // Abort에만 의존하지 않는 stale-wins 방어: 오래된 응답이 최신 요청을 덮지 못한다.
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const isCurrent = () => active && requestId === requestIdRef.current;
    // 성공한 0건도 성공한 조회다. 이전 성공이 있으면 기존 route를 유지하고 background로 갱신한다.
    const background = hasSuccessfulReadRef.current;
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setAuthRequired(false);
    setError(null);

    apiRead('/driver/orders', token, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw toDriverListReadError(response.status);
        }
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error('driver map orders response is not a list');
        return payload as Order[];
      })
      .then((driverOrders) => {
        if (!isCurrent()) return;
        // 지도 목록(배송 중·수거 대기)과 함께, 목록에서 빠지는 보류 주문 수를 세기 위해 보류도 둔다.
        setOrders(
          driverOrders.filter(
            (order) =>
              order.status === 'PREPARING' ||
              order.status === 'DELIVERING' ||
              order.status === 'DELIVERY_HELD',
          ),
        );
        hasSuccessfulReadRef.current = true;
        setHasSuccessfulRead(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!isCurrent() || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        const kind = toDriverListReadErrorKind(cause);
        if (kind === 'AUTH_ERROR') {
          // authority loss(401·403): 이전 protected route를 즉시 제거하고
          // auth-required로 전환한다. stale route 유지·stale navigation을 허용하지 않는다.
          hasSuccessfulReadRef.current = false;
          setOrders([]);
          setHasSuccessfulRead(false);
          setAuthRequired(true);
          setError(null);
          return;
        }
        if (shouldPreserveDriverListOnReadError(kind, hasSuccessfulReadRef.current)) {
          // refresh 실패는 마지막 정상 route를 지우지 않고 stale로 유지한다.
          // stale route를 최신 경로로 오인시키지 않도록 navigation은 fail-closed한다.
          setError('최신 경로를 불러오지 못했어요. 이전 경로를 보여드려요.');
        } else {
          setOrders([]);
          setError('배송 경로를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
        }
      })
      .finally(() => {
        if (!isCurrent()) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [session?.user.id, session?.user.role, session?.user.accessToken, sessionStatus, reloadKey]);

  // 보류 주문은 지도 목록에 올리지 않는다(작업 보드에서 다룬다). 머리에 수만 밝힌다.
  const stops = useMemo(() => orders.filter(isMapStop), [orders]);
  const heldCount = countHeldOrders(orders);
  // O(n²) 정렬이라 목록이 바뀔 때만 다시 계산한다.
  const sorted = useMemo(() => nearestNeighbor(stops), [stops]);
  // 완료 사진이 이 기기 대기열에 있는 주문은 이미 들른 곳이다(3차 재감사 S-02). 작업 보드와 같이
  // 다음 배송지에서 빼고 "사진 올리는 중" 묶음에 두며, 행에 대기열 상태 배지를 붙인다.
  // 멈춘(사진 등록 실패) 사진은 다시 보내지 않으므로 배지만 붙이고 그 주문은 배송 중·다음 배송지 후보에 남긴다.
  const pendingPhotos = usePendingPhotos(session?.user.id);
  const pendingNow = Date.now();
  const pendingBadges = new Map<string, PendingPhotoBadgeKind>(
    pendingPhotos.entries.map((entry) => [entry.orderId, pendingPhotoBadgeKind(entry, pendingNow)]),
  );
  const pendingPhotoOrderIds = inFlightPhotoOrderIds(pendingPhotos.entries);
  // 좌표가 없어 정렬 결과는 경로 순서가 아니므로 번호 대신 상태로 묶어 보인다(배송 중 → 사진 올리는 중 → 수거 대기).
  const groups = groupMapStops(sorted, pendingPhotoOrderIds);
  // 주문에는 배송지 좌표가 없으므로 여러 곳 경유 길안내 대신
  // 다음 배송지 1곳만 연다. 유효 좌표가 없으면 주소 검색 링크로 연다.
  // 다음 배송지는 이미 수거해 배송 중인 내 주문에서만 고르고, 사진이 대기 중인 주문은 고르지 않는다.
  const nextStop = pickNextDeliveryStop(sorted, pendingPhotoOrderIds);
  const hasPhotoPendingStop = sorted.some(
    (order) => order.status === 'DELIVERING' && pendingPhotoOrderIds.has(order.id),
  );
  const nextStopLink = nextStop ? buildOrderMapLink(nextStop) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* 헤더: 작업 보드처럼 머리 아래 선 없이 흰 바탕이다(design-standard.md 기사 앱, 3차 재감사 S-14). */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg)',
          padding: '16px',
        }}
      >
        <h4 className={titleH4}>배송지 지도</h4>
        <p
          className={cn(text, 'mt-0.5')}
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--driver-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {groups.length > 0
            ? groups.map((group) => `${group.label} ${group.orders.length}`).join(' · ')
            : `총 ${stops.length}건`}
        </p>
        {heldCount > 0 && (
          <p
            className={cn(text, 'mt-0.5')}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          >
            보류 {heldCount}곳은 작업 보드에서 확인해요.
          </p>
        )}
      </header>

      {/* 지도는 없고 길안내는 행의 ‘지도’ 링크로 열린다. 첫 화면에 배송지가 더 보이게 한 줄로만 안내한다. */}
      <p
        className={cn(text, 'mx-4 mt-3')}
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
          wordBreak: 'keep-all',
        }}
      >
        배송지마다 ‘지도’를 누르면 카카오맵에서 길안내가 열려요.
      </p>

      {/* 배송지 목록(상태 묶음) */}
      <div style={{ flex: 1, padding: '16px' }}>
        {loading ? (
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128 }}
          >
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
            >
              배송 경로를 불러오고 있어요
            </p>
          </div>
        ) : authRequired ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2.5">
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              로그인이 끝났어요. 다시 로그인해 주세요.
            </p>
            {/* 같은 토큰으로 다시 조회하면 늘 같은 화면이므로 재조회 버튼 없이 로그인으로 보낸다(작업 보드와 같다). */}
            <AppButton onClick={() => void signOut({ redirectTo: '/login' })}>
              다시 로그인
            </AppButton>
          </div>
        ) : error && !hasSuccessfulRead ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2.5">
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              {error}
            </p>
            <AppButton tone="brand-outline" onClick={() => setReloadKey((key) => key + 1)}>
              다시 시도
            </AppButton>
          </div>
        ) : sorted.length === 0 ? (
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128 }}
          >
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
            >
              배송할 주문이 없어요
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {refreshing && (
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
              >
                최신 정보를 확인하고 있어요…
              </p>
            )}
            {error && (
              <div className="flex flex-col items-center justify-center gap-2.5">
                <p
                  className={text}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                >
                  {error} (이전 경로 표시 중)
                </p>
                <AppButton tone="brand-outline" onClick={() => setReloadKey((key) => key + 1)}>
                  다시 시도
                </AppButton>
              </div>
            )}
            {groups.map((group) => (
              <section
                key={`${group.status}-${group.label}`}
                className="flex flex-col gap-1"
                aria-label={group.label}
              >
                <h2
                  className="m-0"
                  style={{
                    fontSize: 'var(--font-size-md)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-text)',
                    lineHeight: 1.4,
                  }}
                >
                  {group.label}
                  <span className="ml-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {group.orders.length}
                  </span>
                </h2>
                {/* 행은 작업 보드 행과 같은 모양이다: 카드 테두리 없이 행 사이 선만 긋는다(S-14). */}
                <ul className="m-0 list-none p-0">
                  {group.orders.map((order, index) => {
                    // 동·호수(상세 주소)를 앞에 쓴다. 거점은 거점 이름이 앞이다.
                    const addr = mapStopAddressLine(order);
                    // stale(error) 상태에서는 목록 행 지도 링크도 fail-closed로 숨긴다.
                    const mapLink = error ? null : buildOrderMapLink(order);
                    const pendingKind =
                      order.status === 'DELIVERING' ? pendingBadges.get(order.id) : undefined;
                    return (
                      <li
                        key={order.id}
                        data-testid={`driver-map-stop-${order.id}`}
                        className="flex min-h-16 items-center gap-3 py-3"
                        style={index === 0 ? undefined : { borderTop: 'var(--border)' }}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <p
                            className={cn(text, 'truncate')}
                            style={{
                              fontWeight: 'var(--fw-bold)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {addr}
                          </p>
                          {pendingKind && <PendingPhotoBadge kind={pendingKind} />}
                          <p
                            className={cn(text, 'truncate')}
                            style={{
                              fontSize: 'var(--font-size-sm)',
                              color: 'var(--driver-text-muted)',
                            }}
                          >
                            {order.buyerName ?? '손님'}
                          </p>
                        </div>
                        {mapLink && (
                          // 전화·길 찾기와 같은 면(--driver-action-surface)·검정 글자. 초록은 주요 버튼에만 쓴다(S-14).
                          <a
                            href={mapLink.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${addr} 카카오맵에서 열기`}
                            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 no-underline"
                            style={{
                              backgroundColor: 'var(--driver-action-surface)',
                              color: 'var(--color-text)',
                              fontSize: 'var(--font-size-sm)',
                              fontWeight: 'var(--fw-bold)',
                            }}
                          >
                            지도
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* 다음 배송지 길안내 버튼: error/stale에서는 fail-closed로 비활성화한다 */}
      {sorted.length > 0 && !loading && !authRequired && !error && hasSuccessfulRead && (
        <div
          style={{
            position: 'sticky',
            bottom: 'calc(72px + env(safe-area-inset-bottom))',
            padding: '0 16px 16px',
          }}
        >
          {nextStopLink ? (
            <AppButton
              href={nextStopLink.href}
              target="_blank"
              rel="noopener noreferrer"
              fullWidth
              size="lg"
            >
              다음 배송지 카카오맵에서 열기
            </AppButton>
          ) : (
            <div className="flex flex-col gap-2.5">
              <AppButton fullWidth size="lg" tone="gray" disabled>
                다음 배송지 카카오맵에서 열기
              </AppButton>
              {nextStop ? (
                <p
                  className={text}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-danger)',
                    textAlign: 'center',
                  }}
                >
                  다음 배송지 주소가 없어 지도를 열 수 없어요. 목록에서 주소를 확인해 주세요.
                </p>
              ) : hasPhotoPendingStop ? (
                // 배송 중 주문이 모두 사진을 찍은 주문이면 더 갈 곳이 없다. 사진은 대기열이 올린다.
                <p
                  className={text}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                    textAlign: 'center',
                    wordBreak: 'keep-all',
                  }}
                >
                  남은 배송지가 없어요. 찍은 사진은 신호가 잡히면 앱이 올려요.
                </p>
              ) : (
                <p
                  className={text}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                    textAlign: 'center',
                  }}
                >
                  아직 배송 중인 주문이 없어요. 수거하고 배송을 시작하면 열 수 있어요.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {sorted.length > 0 && error && hasSuccessfulRead && (
        <div
          style={{
            position: 'sticky',
            bottom: 'calc(72px + env(safe-area-inset-bottom))',
            padding: '0 16px 16px',
          }}
        >
          <div className="flex flex-col gap-2.5">
            <AppButton fullWidth size="lg" tone="gray" disabled>
              다음 배송지 카카오맵에서 열기
            </AppButton>
            <p
              className={text}
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-danger)',
                textAlign: 'center',
              }}
            >
              최신 경로 확인에 실패해 길안내를 열 수 없어요. 다시 시도한 뒤 최신 경로에서 열어
              주세요.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
