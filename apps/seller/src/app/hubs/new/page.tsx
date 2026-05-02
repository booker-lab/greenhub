'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import {
  ActionIcon,
  Box,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ChevronLeft } from 'lucide-react';

export default function NewHubPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    address: '',
    addressDetail: '',
    operatingHours: '',
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const storeId = session?.user.storeId;
    const token = session?.user.accessToken;
    if (!storeId || !token) return;

    setError('');
    setLoading(true);
    try {
      const res = await apiFetch(`/stores/${storeId}/hubs`, token, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          address: form.address,
          addressDetail: form.addressDetail || undefined,
          operatingHours: form.operatingHours || undefined,
        }),
      });
      if (res.ok) {
        router.push('/hubs');
      } else {
        const data = await res.json();
        setError(data.message ?? '저장에 실패했습니다');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      component="main"
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-surface-muted)',
        padding: '32px 16px',
      }}
    >
      <Container size="xs">
        <Group gap="sm" mb="lg">
          <ActionIcon variant="subtle" color="gray" onClick={() => router.back()}>
            <ChevronLeft size={20} />
          </ActionIcon>
          <Title order={2} style={{ fontSize: 'var(--font-size-xl)' }}>
            거점 등록
          </Title>
        </Group>

        <Paper radius="lg" shadow="sm" p="lg">
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label={
                  <>
                    거점 이름{' '}
                    <Text component="span" style={{ color: 'var(--color-danger)' }}>
                      *
                    </Text>
                  </>
                }
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="예: 강남 거점"
                radius="xl"
              />

              <TextInput
                label={
                  <>
                    주소{' '}
                    <Text component="span" style={{ color: 'var(--color-danger)' }}>
                      *
                    </Text>
                  </>
                }
                name="address"
                value={form.address}
                onChange={handleChange}
                required
                placeholder="거점 주소"
                radius="xl"
              />

              <TextInput
                label={
                  <>
                    상세 주소{' '}
                    <Text component="span" style={{ color: 'var(--color-text-disabled)' }}>
                      (선택)
                    </Text>
                  </>
                }
                name="addressDetail"
                value={form.addressDetail}
                onChange={handleChange}
                placeholder="동/호수, 층 등"
                radius="xl"
              />

              <TextInput
                label={
                  <>
                    운영 시간{' '}
                    <Text component="span" style={{ color: 'var(--color-text-disabled)' }}>
                      (선택)
                    </Text>
                  </>
                }
                name="operatingHours"
                value={form.operatingHours}
                onChange={handleChange}
                placeholder="예: 09:00~18:00"
                radius="xl"
              />

              {error && (
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                  ta="center"
                >
                  {error}
                </Text>
              )}

              <Button
                type="submit"
                disabled={loading}
                fullWidth
                size="md"
                radius="xl"
                mt="xs"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {loading ? '등록 중...' : '거점 등록'}
              </Button>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Box>
  );
}
