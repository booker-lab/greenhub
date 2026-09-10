'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/api';
import {
  buildDriverListScope,
  shouldPreserveDriverListOnReadError,
  toDriverListReadError,
  toDriverListReadErrorKind,
} from '@/lib/driver-list-read';
import { Box, Stack, Text, Title, Badge, Button } from '@mantine/core';

type Order = {
  id: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  hubName?: string;
  hubAddress?: string;
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

    apiFetch('/driver/orders', token, { signal: controller.signal })
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
        setOrders(
          driverOrders.filter(
            (order) => order.status === 'PREPARING' || order.status === 'DELIVERING',
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
          setError('최신 경로를 불러오지 못했습니다. 이전 경로를 보여줍니다.');
        } else {
          setOrders([]);
          setError('배송 경로를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
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

  const sorted = nearestNeighbor(orders);

  function buildKakaoNaviUrl() {
    if (sorted.length === 0) return '';
    const last = sorted[sorted.length - 1];
    const lastAddr = last.deliveryMethod === 'hub' ? (last.hubAddress ?? '') : (last.address ?? '');
    return (
      `kakaomap://route?ep=${last.lat ?? 0},${last.lng ?? 0}` +
      `&eName=${encodeURIComponent(lastAddr)}` +
      (sorted.length > 1
        ? `&${sorted
            .slice(0, -1)
            .map((o, i) => (o.lat ? `via${i}Lat=${o.lat}&via${i}Lng=${o.lng}` : ''))
            .filter(Boolean)
            .join('&')}`
        : '')
    );
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      {/* 헤더 */}
      <Box
        component="header"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--color-bg)',
          borderBottom: 'var(--border)',
          padding: '16px',
        }}
      >
        <Title order={4}>오늘 배송 경로</Title>
        <Text
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          mt={2}
        >
          총 {orders.length}건
        </Text>
      </Box>

      {/* 지도 플레이스홀더 */}
      <Box
        mx="md"
        mt="md"
        h={192}
        style={{
          borderRadius: 16,
          backgroundColor: 'var(--color-surface-muted)',
          border: 'var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Stack align="center" gap={4}>
          <svg
            width="40"
            height="40"
            fill="none"
            stroke="var(--color-text-disabled)"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
            />
          </svg>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            카카오맵 SDK 연동 후 활성화
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            NEXT_PUBLIC_KAKAO_MAP_KEY 설정 필요
          </Text>
        </Stack>
      </Box>

      {/* 경유지 목록 */}
      <Box style={{ flex: 1, padding: '16px' }}>
        {loading ? (
          <Box
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128 }}
          >
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              배송 경로를 불러오는 중입니다
            </Text>
          </Box>
        ) : authRequired ? (
          <Stack align="center" justify="center" h={128} gap="xs">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
              로그인이 필요합니다. 세션을 다시 확인해 주세요.
            </Text>
            <Button
              variant="outline"
              color="brand"
              radius="xl"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              다시 시도
            </Button>
          </Stack>
        ) : error && !hasSuccessfulRead ? (
          <Stack align="center" justify="center" h={128} gap="xs">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
              {error}
            </Text>
            <Button
              variant="outline"
              color="brand"
              radius="xl"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              다시 시도
            </Button>
          </Stack>
        ) : sorted.length === 0 ? (
          <Box
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128 }}
          >
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              오늘 배송 주문이 없습니다
            </Text>
          </Box>
        ) : (
          <Stack gap="xs">
            {refreshing && (
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                최신 정보를 확인하는 중입니다…
              </Text>
            )}
            {error && (
              <Stack align="center" justify="center" gap="xs">
                <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
                  {error} (이전 경로 표시 중)
                </Text>
                <Button
                  variant="outline"
                  color="brand"
                  radius="xl"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  다시 시도
                </Button>
              </Stack>
            )}
            {sorted.map((order, idx) => {
              const addr =
                order.deliveryMethod === 'hub'
                  ? `${order.hubName ?? '거점'} · ${order.hubAddress ?? '-'}`
                  : (order.address ?? '-');
              return (
                <Box
                  key={order.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    backgroundColor: 'var(--color-bg)',
                    borderRadius: 12,
                    border: 'var(--border)',
                    padding: '12px 16px',
                  }}
                >
                  <Box
                    style={{
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-bg)',
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-bold)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {idx + 1}
                  </Box>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
                      truncate="end"
                    >
                      {order.buyerName ?? '소비자'}
                    </Text>
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                      truncate="end"
                    >
                      {addr}
                    </Text>
                  </Box>
                  <Badge
                    size="xs"
                    color={order.status === 'DELIVERING' ? 'blue' : 'yellow'}
                    variant="light"
                  >
                    {order.status === 'DELIVERING' ? '배송 중' : '수거 대기'}
                  </Badge>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>

      {/* 주행 시작 버튼: error/stale에서는 fail-closed로 비활성화한다 */}
      {sorted.length > 0 && !loading && !authRequired && !error && hasSuccessfulRead && (
        <Box style={{ position: 'sticky', bottom: 72, padding: '0 16px 16px' }}>
          <Button
            component="a"
            href={buildKakaoNaviUrl()}
            fullWidth
            size="lg"
            radius="xl"
            color="brand"
          >
            주행 시작 (카카오내비)
          </Button>
        </Box>
      )}
      {sorted.length > 0 && error && hasSuccessfulRead && (
        <Box style={{ position: 'sticky', bottom: 72, padding: '0 16px 16px' }}>
          <Stack gap="xs">
            <Button fullWidth size="lg" radius="xl" color="gray" disabled>
              주행 시작 (카카오내비)
            </Button>
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-danger)',
                textAlign: 'center',
              }}
            >
              최신 경로 확인에 실패해 주행을 시작할 수 없습니다. 다시 시도 후 최신 경로에서
              시작해 주세요.
            </Text>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
