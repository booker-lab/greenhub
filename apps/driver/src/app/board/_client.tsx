'use client';

import type { Order } from '@greenhub/shared';
import { Anchor, Badge, Box, Button, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import OrderCard from '@/components/OrderCard';
import { apiFetch } from '@/lib/api';
import {
  buildDriverListScope,
  shouldPreserveDriverListOnReadError,
  toDriverListReadError,
  toDriverListReadErrorKind,
} from '@/lib/driver-list-read';

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
  useEffect(() => {
    const revalidate = () => setReloadKey((key) => key + 1);
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

    apiFetch('/driver/orders', token, { signal: controller.signal })
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
  const today = new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

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
          padding: '16px 16px 0',
        }}
      >
        <Box mb="sm">
          <Title order={4}>오늘 배송</Title>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {today}
          </Text>
        </Box>

        {/* 탭 */}
        <Box style={{ display: 'flex' }}>
          {[
            { key: 'preparing', label: '수거 대기', count: preparing.length },
            { key: 'delivering', label: '배송 중', count: delivering.length },
          ].map(({ key, label, count }) => (
            <UnstyledButton
              key={key}
              onClick={() => router.replace(`/board?tab=${key}`)}
              style={{
                flex: 1,
                padding: '12px 0',
                textAlign: 'center',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                borderBottom: `2px solid ${tab === key ? 'var(--color-primary)' : 'transparent'}`,
                color: tab === key ? 'var(--color-primary)' : 'var(--color-text-disabled)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {label}
              {count > 0 && (
                <Badge size="xs" color={key === 'preparing' ? 'red' : 'blue'} circle>
                  {count}
                </Badge>
              )}
            </UnstyledButton>
          ))}
        </Box>
      </Box>

      {/* 주문 목록 */}
      <Box component="main" style={{ flex: 1, padding: '16px' }}>
        {loading ? (
          <Stack align="center" justify="center" h={192} gap="xs">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              주문을 불러오는 중입니다
            </Text>
          </Stack>
        ) : authRequired ? (
          <Stack align="center" justify="center" h={192} gap="xs">
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
          <Stack align="center" justify="center" h={192} gap="xs">
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
        ) : error && hasSuccessfulRead ? (
          orders.length === 0 ? (
            <Stack align="center" justify="center" h={192} gap="xs">
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
                {error}
              </Text>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                {tab === 'preparing'
                  ? '마지막 확인 당시 수거할 주문이 없었습니다.'
                  : '마지막 확인 당시 배송 중인 주문이 없었습니다.'}
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
          ) : (
            <Stack gap="sm">
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
                    {error} (이전 목록 표시 중)
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
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} tab={tab} />
              ))}
            </Stack>
          )
        ) : refreshing && hasSuccessfulRead && orders.length === 0 ? (
          <Stack align="center" justify="center" h={192} gap="xs">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              최신 정보를 확인하는 중입니다…
            </Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {tab === 'preparing'
                ? '마지막 확인 당시 수거할 주문이 없었습니다.'
                : '마지막 확인 당시 배송 중인 주문이 없었습니다.'}
            </Text>
          </Stack>
        ) : orders.length === 0 ? (
          <Stack align="center" justify="center" h={192} gap="xs">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {tab === 'preparing'
                ? '오늘 수거할 주문이 없습니다'
                : '현재 배송 중인 주문이 없습니다'}
            </Text>
            {tab === 'preparing' && (
              <Anchor
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}
                onClick={() => router.push('/map')}
              >
                지도에서 경로 보기
              </Anchor>
            )}
          </Stack>
        ) : (
          <Stack gap="sm">
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
                  {error} (이전 목록 표시 중)
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
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} tab={tab} />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
