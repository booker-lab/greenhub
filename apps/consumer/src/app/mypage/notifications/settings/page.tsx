'use client';

import { Alert, Badge, Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API_URL = getApiBaseUrl();

type MarketingChannel = 'alimtalk' | 'sms';

interface MarketingPreferences {
  alimtalk: boolean;
  sms: boolean;
}

type Requester = (input: string, init: RequestInit) => Promise<Response>;

const CHANNELS: Array<{
  id: MarketingChannel;
  title: string;
  description: string;
}> = [
  {
    id: 'alimtalk',
    title: '카카오톡 마케팅',
    description: '신상품과 할인 정보를 카카오톡으로 받는 선택 동의입니다.',
  },
  {
    id: 'sms',
    title: '문자 마케팅',
    description: '신상품과 할인 정보를 문자로 받는 선택 동의입니다.',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPreferencePair(value: unknown): MarketingPreferences | null {
  if (
    !isRecord(value) ||
    typeof value['alimtalk'] !== 'boolean' ||
    typeof value['sms'] !== 'boolean'
  ) {
    return null;
  }
  return {
    alimtalk: value['alimtalk'],
    sms: value['sms'],
  };
}

function readMarketingPreferences(value: unknown): MarketingPreferences | null {
  if (!isRecord(value)) return null;
  return readPreferencePair(value['notificationPreferences']);
}

async function fetchMarketingPreferences(
  accessToken: string,
  request: Requester = fetch,
): Promise<MarketingPreferences> {
  if (!accessToken) throw new Error('로그인 정보를 확인할 수 없습니다.');

  const response = await request(`${API_URL}/auth/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('현재 마케팅 동의 상태를 불러오지 못했습니다.');
  }

  const body: unknown = await response.json().catch(() => null);
  const preferences = readMarketingPreferences(body);
  if (!preferences) {
    throw new Error('현재 마케팅 동의 상태 응답을 확인할 수 없습니다.');
  }
  return preferences;
}

async function withdrawMarketingPreference(
  channel: MarketingChannel,
  accessToken: string,
  request: Requester = fetch,
): Promise<MarketingPreferences> {
  if (!accessToken) throw new Error('로그인 정보를 확인할 수 없습니다.');

  const response = await request(`${API_URL}/notifications/me/preferences`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ [channel]: false }),
  });
  if (!response.ok) {
    throw new Error('마케팅 동의 철회에 실패했습니다.');
  }

  const body: unknown = await response.json().catch(() => null);
  const preferences = readPreferencePair(body);
  if (!preferences || preferences[channel] !== false) {
    throw new Error('마케팅 동의 철회 응답을 확인할 수 없습니다.');
  }
  return preferences;
}

function MarketingChannelCard({
  channel,
  agreed,
  pending,
  onWithdraw,
}: {
  channel: (typeof CHANNELS)[number];
  agreed: boolean;
  pending: boolean;
  onWithdraw: () => void;
}) {
  return (
    <Paper p="md" radius="md" withBorder>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Box>
          <Text fw="var(--fw-bold)" size="sm">
            {channel.title}
          </Text>
          <Text size="sm" c="var(--color-text-secondary)" mt={4}>
            {channel.description}
          </Text>
        </Box>
        <Badge color={agreed ? 'green' : 'gray'} variant="light" style={{ flexShrink: 0 }}>
          {agreed ? '동의함' : '동의하지 않음'}
        </Badge>
      </Group>

      {agreed && (
        <Button
          fullWidth
          mt="md"
          color="red"
          variant="light"
          loading={pending}
          disabled={pending}
          onClick={onWithdraw}
        >
          {channel.title} 즉시 철회
        </Button>
      )}
    </Paper>
  );
}

export default function NotificationSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [preferences, setPreferences] = useState<MarketingPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingChannel, setPendingChannel] = useState<MarketingChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const accessToken = session?.user?.accessToken;

  useEffect(() => {
    void reloadKey;
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;
    if (!accessToken) {
      setPreferences(null);
      setError('로그인 정보를 확인할 수 없습니다.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    fetchMarketingPreferences(accessToken)
      .then((nextPreferences) => {
        if (!cancelled) setPreferences(nextPreferences);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setPreferences(null);
        setError(cause instanceof Error ? cause.message : '현재 상태를 확인할 수 없습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadKey, router, status]);

  async function handleWithdraw(channel: MarketingChannel) {
    if (!accessToken || !preferences?.[channel] || pendingChannel) return;

    setPendingChannel(channel);
    setError(null);
    setNotice(null);
    try {
      const nextPreferences = await withdrawMarketingPreference(channel, accessToken);
      setPreferences(nextPreferences);
      const label = CHANNELS.find((candidate) => candidate.id === channel)?.title ?? '마케팅';
      setNotice(`${label} 동의를 철회했습니다.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '마케팅 동의 철회에 실패했습니다.');
    } finally {
      setPendingChannel(null);
    }
  }

  return (
    <Box style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>
      <Group
        px="md"
        pt="lg"
        pb="sm"
        gap="xs"
        style={{
          position: 'sticky',
          top: 0,
          background: 'var(--color-bg)',
          zIndex: 10,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Button
          aria-label="뒤로 가기"
          variant="transparent"
          style={{ color: 'var(--color-text)' }}
          px={0}
          onClick={() => router.back()}
        >
          <ChevronLeft size={20} />
        </Button>
        <Title order={2} style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}>
          마케팅 알림 설정
        </Title>
      </Group>

      <Stack px="md" py="lg" gap="md">
        <Paper p="md" radius="md" bg="var(--color-surface-muted)">
          <Text size="sm" fw="var(--fw-bold)" mb={4}>
            정보성 연락은 계속 제공됩니다
          </Text>
          <Text size="sm" c="var(--color-text-secondary)">
            주문·결제·배송을 위한 정보성 연락은 선택 마케팅과 별개이며, 마케팅 동의 여부와 관계없이
            필요한 안내를 받을 수 있습니다.
          </Text>
        </Paper>

        <Text size="sm" c="var(--color-text-secondary)">
          아래 상태는 로그인한 계정의 서버 저장값을 새로 확인한 결과입니다.
        </Text>

        {loading && (
          <Text ta="center" c="var(--color-text-disabled)" py="xl">
            현재 동의 상태를 확인하는 중...
          </Text>
        )}

        {error && (
          <Alert color="red" variant="light">
            <Stack gap="sm">
              <Text size="sm">{error}</Text>
              {!preferences && status === 'authenticated' && (
                <Button
                  variant="light"
                  color="red"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  다시 확인
                </Button>
              )}
            </Stack>
          </Alert>
        )}

        {notice && (
          <Alert color="green" variant="light">
            <Text size="sm">{notice}</Text>
          </Alert>
        )}

        {!loading &&
          preferences &&
          CHANNELS.map((channel) => (
            <MarketingChannelCard
              key={channel.id}
              channel={channel}
              agreed={preferences[channel.id]}
              pending={pendingChannel === channel.id}
              onWithdraw={() => handleWithdraw(channel.id)}
            />
          ))}

        {!loading && preferences && (
          <Text size="xs" c="var(--color-text-disabled)">
            동의·철회 증거와 보관은 서버 정책에 따라 처리되며 이 화면은 해당 기록에 직접 접근하지
            않습니다.
          </Text>
        )}
      </Stack>
    </Box>
  );
}
