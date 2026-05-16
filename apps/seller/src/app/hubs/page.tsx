'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { Badge, Button, Container, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';

interface Hub {
  id: string;
  name: string;
  address: string;
  addressDetail: string | null;
  operatingHours: string | null;
  isActive: boolean;
}

export default function HubsPage() {
  const { data: session } = useSession();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const fetchHubs = useCallback(async () => {
    if (!storeId || !token) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/stores/${storeId}/hubs`, token);
      if (res.ok) {
        const data = await res.json();
        setHubs(data.hubs);
      }
    } finally {
      setLoading(false);
    }
  }, [storeId, token]);

  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  async function toggleActive(hub: Hub) {
    if (!storeId || !token) return;
    const res = await apiFetch(`/stores/${storeId}/hubs/${hub.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !hub.isActive }),
    });
    if (res.ok) {
      setHubs((prev) => prev.map((h) => (h.id === hub.id ? { ...h, isActive: !hub.isActive } : h)));
    }
  }

  async function deleteHub(hubId: string) {
    if (!storeId || !token) return;
    if (!confirm('거점을 삭제하시겠습니까?')) return;
    const res = await apiFetch(`/stores/${storeId}/hubs/${hubId}`, token, {
      method: 'DELETE',
    });
    if (res.ok) {
      setHubs((prev) => prev.filter((h) => h.id !== hubId));
    } else {
      setError('삭제에 실패했습니다');
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="거점 관리"
        right={
          <Button
            component={Link}
            href="/hubs/new"
            size="xs"
            radius="md"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            + 거점 등록
          </Button>
        }
      />

      <Container size="sm" px="md" py="md">
        {error && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }} mb="sm">
            {error}
          </Text>
        )}

        {loading ? (
          <LoadingState />
        ) : hubs.length === 0 ? (
          <EmptyState
            icon={
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            }
            text="등록된 거점이 없습니다"
            action={
              <Text
                component={Link}
                href="/hubs/new"
                mt="xs"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-primary)',
                  fontWeight: 500,
                }}
              >
                거점 등록하기 →
              </Text>
            }
          />
        ) : (
          <Stack gap="sm">
            {hubs.map((hub) => (
              <Paper key={hub.id} radius="lg" px="md" py="md" shadow="xs">
                <Group justify="space-between" align="flex-start" gap="xs">
                  <UnstyledButton
                    component={Link}
                    href={`/hubs/${hub.id}`}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <Group gap="xs" mb={4}>
                      <Text
                        style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--font-size-sm)' }}
                        truncate
                      >
                        {hub.name}
                      </Text>
                      <Badge
                        color={hub.isActive ? 'green' : 'gray'}
                        variant="light"
                        radius="xl"
                        size="xs"
                        style={{ flexShrink: 0 }}
                      >
                        {hub.isActive ? '운영 중' : '비활성'}
                      </Badge>
                    </Group>
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                      truncate
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
                        mt={4}
                      >
                        운영: {hub.operatingHours}
                      </Text>
                    )}
                  </UnstyledButton>
                  <Stack gap={4} style={{ flexShrink: 0 }}>
                    <Button
                      onClick={() => toggleActive(hub)}
                      size="xs"
                      variant="light"
                      color="blue"
                      radius="md"
                    >
                      {hub.isActive ? '비활성화' : '활성화'}
                    </Button>
                    <Button
                      onClick={() => deleteHub(hub.id)}
                      size="xs"
                      variant="light"
                      color="red"
                      radius="md"
                    >
                      삭제
                    </Button>
                  </Stack>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Container>
    </PageShell>
  );
}
