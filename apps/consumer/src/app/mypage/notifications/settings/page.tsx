'use client';

import { Alert, AlertDescription } from '@greenhub/ui/components/alert';
import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API_URL = getApiBaseUrl();
const MARKETING_NOT_USED_IN_PILOT = true;

// ① 외형 유지(UI 교체 P5): Mantine Group(gap xs 10)·Stack(px md·py lg·gap md 16)·Title order 2(줄 높이 1.35)·
// Text size sm(15px·줄 높이 1.45)·Alert light gray·red·green·Paper(md 16, radius md 8, withBorder gray-3)·
// Badge light green·gray·Button transparent(좌우 여백 0)·Button light red와 같은 값.
const TEXT_SM = 'm-0 p-0 text-[15px] leading-[1.45]';
const BOLD = { fontWeight: 'var(--fw-bold)' } as const;

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
    <div className="rounded-[8px] border border-solid border-[#dee2e6] bg-white p-4">
      <div className="flex flex-row flex-nowrap items-start justify-between gap-4">
        <div>
          <p className={TEXT_SM} style={BOLD}>
            {channel.title}
          </p>
          <p className={`${TEXT_SM} mt-1`} style={{ color: 'var(--color-text-secondary)' }}>
            {channel.description}
          </p>
        </div>
        <Badge variant={agreed ? 'light-green' : 'secondary'} style={{ flexShrink: 0 }}>
          {agreed ? '동의함' : '동의하지 않음'}
        </Badge>
      </div>

      {agreed && (
        <LoadingButton
          type="button"
          variant="light-destructive"
          className="mt-4 w-full"
          loading={pending}
          disabled={pending}
          onClick={onWithdraw}
        >
          {channel.title} 즉시 철회
        </LoadingButton>
      )}
    </div>
  );
}

function SettingsHeader({ onBack }: { onBack: () => void }) {
  return (
    <div
      className="flex flex-row flex-wrap items-center justify-start gap-2.5 px-4 pt-5 pb-3"
      style={{
        position: 'sticky',
        top: 0,
        background: 'var(--color-bg)',
        zIndex: 10,
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <Button
        type="button"
        aria-label="뒤로 가기"
        variant="ghost"
        className="px-0 hover:bg-transparent"
        style={{ color: 'var(--color-text)' }}
        onClick={onBack}
      >
        <ChevronLeft size={20} className="size-5" />
      </Button>
      <h2
        className="m-0 leading-[1.35]"
        style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}
      >
        마케팅 알림 설정
      </h2>
    </div>
  );
}

export default function NotificationSettingsPage() {
  const router = useRouter();

  if (MARKETING_NOT_USED_IN_PILOT) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>
        <SettingsHeader onBack={() => router.back()} />

        <div className="flex flex-col items-stretch justify-start gap-4 px-4 py-5">
          <Alert role="alert" variant="secondary">
            <AlertDescription>
              <p className={`${TEXT_SM} mb-1`} style={BOLD}>
                파일럿에서는 마케팅 수신 동의와 설정을 운영하지 않습니다.
              </p>
              <p className={TEXT_SM}>
                주문·결제·배송에 필요한 정보성 연락은 마케팅 동의와 별개로 계속 제공됩니다.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return <LegacyNotificationSettingsPage />;
}

function LegacyNotificationSettingsPage() {
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
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>
      <SettingsHeader onBack={() => router.back()} />

      <div className="flex flex-col items-stretch justify-start gap-4 px-4 py-5">
        <div className="rounded-[8px] p-4" style={{ background: 'var(--color-surface-muted)' }}>
          <p className={`${TEXT_SM} mb-1`} style={BOLD}>
            정보성 연락은 계속 제공됩니다
          </p>
          <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
            주문·결제·배송을 위한 정보성 연락은 선택 마케팅과 별개이며, 마케팅 동의 여부와 관계없이
            필요한 안내를 받을 수 있습니다.
          </p>
        </div>

        <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
          아래 상태는 로그인한 계정의 서버 저장값을 새로 확인한 결과입니다.
        </p>

        {loading && (
          <p
            className="m-0 p-0 py-8 text-center text-[16px] leading-[1.55]"
            style={{ color: 'var(--color-text-disabled)' }}
          >
            현재 동의 상태를 확인하는 중...
          </p>
        )}

        {error && (
          <Alert role="alert" variant="destructive">
            <AlertDescription>
              <div className="flex flex-col items-stretch justify-start gap-3">
                <p className={TEXT_SM}>{error}</p>
                {!preferences && status === 'authenticated' && (
                  <Button
                    type="button"
                    variant="light-destructive"
                    onClick={() => setReloadKey((value) => value + 1)}
                  >
                    다시 확인
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {notice && (
          // Mantine Alert light green(green-1 면·green-9 글자).
          <Alert role="alert" className="bg-[#d3f9d8] text-[#2b8a3e]">
            <AlertDescription>
              <p className={TEXT_SM}>{notice}</p>
            </AlertDescription>
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
          <p className={TEXT_SM} style={{ color: 'var(--color-text-disabled)' }}>
            동의·철회 증거와 보관은 서버 정책에 따라 처리되며 이 화면은 해당 기록에 직접 접근하지
            않습니다.
          </p>
        )}
      </div>
    </div>
  );
}
