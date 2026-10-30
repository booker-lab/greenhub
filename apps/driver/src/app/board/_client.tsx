'use client';

import type { Order } from '@greenhub/shared';
import { Badge } from '@greenhub/ui/components/badge';
import { cn } from '@greenhub/ui/lib/utils';
import { useRouter, useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { AppButton } from '@/components/app-button';
import { badgeCircle, badgeSize, badgeTone, text, titleH4 } from '@/components/look';
import OrderCard from '@/components/OrderCard';
import { apiRead } from '@/lib/api';
import {
  buildDriverListScope,
  shouldPreserveDriverListOnReadError,
  toDriverListReadError,
  toDriverListReadErrorKind,
} from '@/lib/driver-list-read';

/** 복귀 재조회 묶음 간격. focus·visibilitychange가 이 간격 안에 겹치면 목록을 한 번만 다시 조회한다. */
const REVALIDATE_COALESCE_MS = 1_500;

export default function BoardClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const tab = searchParams.get('tab') ?? 'preparing';

  const [preparing, setPreparing] = useState<Order[]>([]);
  const [delivering, setDelivering] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasSuccessfulRead, setHasSuccessfulRead] = useState(false);
  const requestIdRef = useRef(0);
  const hasSuccessfulReadRef = useRef(false);
  // user identity + role + access token scope가 바뀌면 이전 scope의
  // protected rows를 새 fetch 완료 전에 동기적으로 제거한다.
  const listScopeRef = useRef<string | null>(null);

  // focus 복귀·visibility 복귀 시 새 read를 수행한다. listener 누적 방지를 위해 cleanup한다.
  // 앱 복귀 한 번에 focus와 visibilitychange가 함께 오므로 짧은 간격 안의 중복은 한 번으로 묶는다.
  useEffect(() => {
    let lastRevalidateAt = Number.NEGATIVE_INFINITY;
    const revalidate = () => {
      const now = Date.now();
      if (now - lastRevalidateAt < REVALIDATE_COALESCE_MS) return;
      lastRevalidateAt = now;
      setReloadKey((key) => key + 1);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') revalidate();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is an intentional manual-refresh trigger for the error-state retry button
  useEffect(() => {
    if (sessionStatus === 'loading') return;

    const token = session?.user.accessToken;
    if (!token) {
      // usable token 없음을 0건 성공으로 표시하지 않는다. 보호된 stale도 유지하지 않는다.
      // stale-empty가 auth 이후 initial failure로 오분류되지 않도록 성공 기록도 초기화한다.
      requestIdRef.current += 1;
      listScopeRef.current = '__no_token__';
      hasSuccessfulReadRef.current = false;
      setHasSuccessfulRead(false);
      setPreparing([]);
      setDelivering([]);
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
      // protected rows·성공 기록·error/freshness를 동기적으로 제거한다.
      // 진행 중이던 이전 scope read는 sequence 무효화로 덮어쓰기를 막는다.
      requestIdRef.current += 1;
      listScopeRef.current = nextScope;
      hasSuccessfulReadRef.current = false;
      setHasSuccessfulRead(false);
      setPreparing([]);
      setDelivering([]);
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
    // 성공한 0건도 성공한 조회다. 이전 성공이 있으면 기존 list를 유지하고 background로 갱신한다.
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
        if (!response.ok) throw toDriverListReadError(response.status);
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error('driver orders response is not a list');
        return payload as Order[];
      })
      .then((orders) => {
        if (!isCurrent()) return;
        setPreparing(orders.filter((order) => order.status === 'PREPARING'));
        setDelivering(
          orders.filter(
            (order) => order.status === 'DELIVERING' || order.status === 'DELIVERY_HELD',
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
          // authority loss(401·403): 이전 protected rows를 즉시 제거하고
          // auth-required로 전환한다. 일반 retry loop가 권한 복구 없이
          // stale data를 유지하지 않는다.
          hasSuccessfulReadRef.current = false;
          setHasSuccessfulRead(false);
          setPreparing([]);
          setDelivering([]);
          setAuthRequired(true);
          setError(null);
          return;
        }
        if (shouldPreserveDriverListOnReadError(kind, hasSuccessfulReadRef.current)) {
          // refresh 실패는 마지막 정상 데이터를 지우지 않고 stale로 유지한다.
          setError('최신 주문을 불러오지 못했습니다. 기존 목록을 보여줍니다.');
        } else {
          setPreparing([]);
          setDelivering([]);
          setError('주문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
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

  const orders = tab === 'preparing' ? preparing : delivering;
  // 서버(UTC)와 휴대폰이 같은 날짜를 그리도록 한국 시간으로 고정한다(오전 9시 전 하루 밀림 방지).
  const today = new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Seoul',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* 헤더 */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg)',
          borderBottom: 'var(--border)',
          padding: '16px 16px 0',
        }}
      >
        <div className="mb-3">
          <h4 className={titleH4}>오늘 배송</h4>
          <p
            className={text}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {today}
          </p>
        </div>

        {/* 탭 */}
        <div style={{ display: 'flex' }}>
          {[
            { key: 'preparing', label: '수거 대기', count: preparing.length },
            { key: 'delivering', label: '배송 중', count: delivering.length },
          ].map(({ key, label, count }) => (
            <button
              type="button"
              key={key}
              className="cursor-pointer appearance-none border-0 bg-transparent text-inherit no-underline"
              onClick={() => router.replace(`/board?tab=${key}`)}
              style={{
                flex: 1,
                padding: '12px 0',
                textAlign: 'center',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                borderBottom: `2px solid ${tab === key ? 'var(--color-primary)' : 'transparent'}`,
                color: tab === key ? 'var(--color-primary-dark)' : 'var(--color-text-disabled)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {label}
              {count > 0 && (
                <Badge
                  className={cn(
                    badgeSize.xs,
                    badgeCircle,
                    badgeTone[key === 'preparing' ? 'brand-filled' : 'dark-filled'],
                  )}
                >
                  {count}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* 주문 목록 */}
      <main style={{ flex: 1, padding: '16px' }}>
        {loading ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2.5">
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              주문을 불러오는 중입니다
            </p>
          </div>
        ) : authRequired ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2.5">
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              로그인이 필요합니다. 세션을 다시 확인해 주세요.
            </p>
            {/* 인증 오류는 같은 토큰으로 재조회해도 반복되므로 세션을 정리하고 로그인으로 보낸다. */}
            <AppButton onClick={() => void signOut({ redirectTo: '/login' })}>
              다시 로그인
            </AppButton>
            <AppButton tone="brand-outline" onClick={() => setReloadKey((key) => key + 1)}>
              다시 시도
            </AppButton>
          </div>
        ) : error && !hasSuccessfulRead ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2.5">
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
        ) : error && hasSuccessfulRead ? (
          orders.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2.5">
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                {error}
              </p>
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                {tab === 'preparing'
                  ? '마지막 확인 당시 수거할 주문이 없었습니다.'
                  : '마지막 확인 당시 배송 중인 주문이 없었습니다.'}
              </p>
              <AppButton tone="brand-outline" onClick={() => setReloadKey((key) => key + 1)}>
                다시 시도
              </AppButton>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {refreshing && (
                <p
                  className={text}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  최신 정보를 확인하는 중입니다…
                </p>
              )}
              {error && (
                <div className="flex flex-col items-center justify-center gap-2.5">
                  <p
                    className={text}
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                  >
                    {error} (이전 목록 표시 중)
                  </p>
                  <AppButton tone="brand-outline" onClick={() => setReloadKey((key) => key + 1)}>
                    다시 시도
                  </AppButton>
                </div>
              )}
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} tab={tab} />
              ))}
            </div>
          )
        ) : refreshing && hasSuccessfulRead && orders.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2.5">
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              최신 정보를 확인하는 중입니다…
            </p>
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {tab === 'preparing'
                ? '마지막 확인 당시 수거할 주문이 없었습니다.'
                : '마지막 확인 당시 배송 중인 주문이 없었습니다.'}
            </p>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2.5">
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {tab === 'preparing'
                ? '오늘 수거할 주문이 없습니다'
                : '현재 배송 중인 주문이 없습니다'}
            </p>
            {tab === 'preparing' && (
              <button
                type="button"
                className="m-0 inline cursor-pointer appearance-none border-0 bg-transparent p-0 no-underline hover:underline"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-dark)' }}
                onClick={() => router.push('/map')}
              >
                지도에서 경로 보기
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {refreshing && (
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                최신 정보를 확인하는 중입니다…
              </p>
            )}
            {error && (
              <div className="flex flex-col items-center justify-center gap-2.5">
                <p
                  className={text}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                >
                  {error} (이전 목록 표시 중)
                </p>
                <AppButton tone="brand-outline" onClick={() => setReloadKey((key) => key + 1)}>
                  다시 시도
                </AppButton>
              </div>
            )}
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} tab={tab} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
