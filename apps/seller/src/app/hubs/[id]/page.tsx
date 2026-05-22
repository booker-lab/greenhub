'use client';

import { Badge, Box, Button, Container, Group, Paper, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { LoadingState } from '@/components/StateViews';
import { ApiError, apiJson } from '@/lib/api';

interface Hub {
  id: string;
  name: string;
  address: string;
  addressDetail: string | null;
  operatingHours: string | null;
  isActive: boolean;
}

interface HubOrder {
  id: string;
  orderId?: string;
  status: string;
  totalAmount: number;
  createdAt: { seconds: number } | string;
  items?: { name: string; quantity: number }[];
  customerName?: string;
  pickupCode?: string;
}

function formatTime(ts: { seconds: number } | string | undefined): string {
  if (!ts) return '-';
  const date =
    typeof ts === 'string' ? new Date(ts) : new Date((ts as { seconds: number }).seconds * 1000);
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HubDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const hubId = params.id as string;

  const [hub, setHub] = useState<Hub | null>(null);
  const [orders, setOrders] = useState<HubOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const fetchData = useCallback(async () => {
    if (!storeId || !token) return;
    setLoading(true);
    try {
      const [hubData, ordersData] = await Promise.all([
        apiJson<Hub>(`/stores/${storeId}/hubs/${hubId}`, token),
        apiJson<{ orders?: HubOrder[] }>(
          `/stores/${storeId}/hubs/${hubId}/orders?status=HUB_ARRIVED`,
          token,
        ),
      ]);
      setHub(hubData);
      setOrders(ordersData.orders ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '네트워크 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }, [storeId, token, hubId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const orderId = (o: HubOrder) => o.id ?? o.orderId ?? '';

  return (
    <PageShell>
      <PageHeader
        title={hub ? hub.name : '거점 상세'}
        onBack={() => router.back()}
        right={
          hub ? (
            <Button
              component={Link}
              href={`/hubs/${hubId}/edit`}
              size="xs"
              variant="light"
              color="gray"
              radius="md"
            >
              수정
            </Button>
          ) : undefined
        }
      />

      <Container size="sm" px="md" py="md">
        <Stack gap="md">
          {error && (
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
              {error}
            </Text>
          )}

          {loading ? (
            <LoadingState />
          ) : hub ? (
            <>
              {/* 거점 정보 카드 */}
              <Paper radius="lg" px="md" py="md" shadow="xs">
                <Stack gap="xs">
                  <Badge
                    color={hub.isActive ? 'green' : 'gray'}
                    variant="light"
                    radius="xl"
                    size="sm"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {hub.isActive ? '운영 중' : '비활성'}
                  </Badge>
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {hub.address}
                  </Text>
                  {hub.addressDetail && (
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      {hub.addressDetail}
                    </Text>
                  )}
                  {hub.operatingHours && (
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      운영시간: {hub.operatingHours}
                    </Text>
                  )}
                </Stack>
              </Paper>

              {/* 픽업 대기 주문 목록 */}
              <Box>
                <Group justify="space-between" mb="xs">
                  <Text
                    style={{
                      fontWeight: 'var(--fw-medium)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    픽업 대기 주문
                  </Text>
                  <Text
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                  >
                    {orders.length}건
                  </Text>
                </Group>

                {orders.length === 0 ? (
                  <Paper radius="lg" px="md" py={40} shadow="xs">
                    <Stack align="center" style={{ color: 'var(--color-text-disabled)' }}>
                      <svg
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      </svg>
                      <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                        픽업 대기 주문이 없습니다
                      </Text>
                    </Stack>
                  </Paper>
                ) : (
                  <Stack gap="sm">
                    {orders.map((order) => (
                      <Paper
                        key={orderId(order)}
                        component="button"
                        radius="lg"
                        px="md"
                        py="md"
                        shadow="xs"
                        onClick={() =>
                          router.push(`/hubs/${hubId}/pickup?orderId=${orderId(order)}`)
                        }
                        style={{ width: '100%', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <Group justify="space-between" gap="xs">
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Group gap="xs" mb={4}>
                              <Badge color="yellow" variant="light" radius="xl" size="xs">
                                픽업 대기
                              </Badge>
                              <Text
                                style={{
                                  fontSize: 'var(--font-size-sm)',
                                  color: 'var(--color-text-disabled)',
                                }}
                              >
                                {formatTime(order.createdAt)}
                              </Text>
                            </Group>
                            {order.items && order.items.length > 0 && (
                              <Text
                                style={{
                                  fontSize: 'var(--font-size-sm)',
                                  fontWeight: 'var(--fw-medium)',
                                }}
                                truncate
                              >
                                {order.items[0].name}
                                {order.items.length > 1 && ` 외 ${order.items.length - 1}건`}
                              </Text>
                            )}
                            <Text
                              style={{
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-disabled)',
                              }}
                              mt={2}
                            >
                              {order.totalAmount?.toLocaleString()}원
                            </Text>
                          </Box>
                          <Box style={{ color: 'var(--color-text-disabled)' }}>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </Box>
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Box>
            </>
          ) : null}
        </Stack>
      </Container>
    </PageShell>
  );
}
