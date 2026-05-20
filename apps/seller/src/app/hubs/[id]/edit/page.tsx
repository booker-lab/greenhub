'use client';

import { Button, Container, Paper, Stack, Text, TextInput } from '@mantine/core';
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

/** 필수 필드 라벨에 빨간 별표를 붙인다. */
function RequiredLabel({ children }: { children: string }) {
  return (
    <>
      {children}{' '}
      <Text component="span" style={{ color: 'var(--color-danger)' }}>
        *
      </Text>
    </>
  );
}

/** 선택 필드 라벨에 회색 "(선택)" 표기를 붙인다. */
function OptionalLabel({ children }: { children: string }) {
  return (
    <>
      {children}{' '}
      <Text component="span" style={{ color: 'var(--color-text-disabled)' }}>
        (선택)
      </Text>
    </>
  );
}

export default function EditHubPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const hubId = params.id as string;

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    address: '',
    addressDetail: '',
    operatingHours: '',
  });

  const fetchHub = useCallback(async () => {
    if (!storeId || !token) return;
    setLoading(true);
    setError('');
    try {
      const hub = await apiJson<Hub>(`/stores/${storeId}/hubs/${hubId}`, token);
      setForm({
        name: hub.name,
        address: hub.address,
        addressDetail: hub.addressDetail ?? '',
        operatingHours: hub.operatingHours ?? '',
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '거점 정보를 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  }, [storeId, token, hubId]);

  useEffect(() => {
    fetchHub();
  }, [fetchHub]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !token) return;

    setError('');
    setSaving(true);
    try {
      // addressDetail·operatingHours는 폼 값을 그대로 전송 — 빈 문자열로
      // 비우면 updateHub가 해당 필드를 ''로 갱신한다(undefined면 미변경).
      await apiJson(`/stores/${storeId}/hubs/${hubId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          address: form.address,
          addressDetail: form.addressDetail,
          operatingHours: form.operatingHours,
        }),
      });
      router.push(`/hubs/${hubId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장에 실패했습니다');
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <PageHeader title="거점 수정" onBack={() => router.back()} />

      <Container size="sm" px="md" py="md">
        {loading ? (
          <LoadingState />
        ) : (
          <Paper radius="lg" shadow="sm" p="lg">
            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                <TextInput
                  label={<RequiredLabel>거점 이름</RequiredLabel>}
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  placeholder="예: 강남 거점"
                  radius="xl"
                />

                <TextInput
                  label={<RequiredLabel>주소</RequiredLabel>}
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  required
                  placeholder="거점 주소"
                  radius="xl"
                />

                <TextInput
                  label={<OptionalLabel>상세 주소</OptionalLabel>}
                  name="addressDetail"
                  value={form.addressDetail}
                  onChange={handleChange}
                  placeholder="동/호수, 층 등"
                  radius="xl"
                />

                <TextInput
                  label={<OptionalLabel>운영 시간</OptionalLabel>}
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
                  disabled={saving}
                  fullWidth
                  size="md"
                  radius="xl"
                  mt="xs"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {saving ? '저장 중...' : '변경 저장'}
                </Button>
              </Stack>
            </form>
          </Paper>
        )}
      </Container>
    </PageShell>
  );
}
