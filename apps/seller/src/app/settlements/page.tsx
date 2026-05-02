'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/api';
import {
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';

type SettlementTab = 'daily' | 'period' | 'orders';
type SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled';

interface Settlement {
  id: string;
  orderId: string;
  totalAmount: number;
  platformFee: number;
  netAmount: number;
  status: SettlementStatus;
  settledAt: { _seconds: number };
}

interface Summary {
  date: string;
  count: number;
  totalAmount: number;
  totalPlatformFee: number;
  totalNetAmount: number;
  byStatus: Record<SettlementStatus, number>;
}

const STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: '정산 대기',
  confirmed: '확정',
  paid: '지급 완료',
  cancelled: '취소',
};

const STATUS_COLOR: Record<SettlementStatus, string> = {
  pending: 'yellow',
  confirmed: 'blue',
  paid: 'green',
  cancelled: 'red',
};

function toKRW(n: number) {
  return `₩${n.toLocaleString('ko-KR')}`;
}

function toDateStr(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function downloadCSV(items: Settlement[], from: string, to: string) {
  const header = '주문ID,정산일시,총금액,플랫폼수수료,정산액,상태';
  const rows = items.map((s) =>
    [
      s.orderId,
      new Date(s.settledAt._seconds * 1000).toISOString(),
      s.totalAmount,
      s.platformFee,
      s.netAmount,
      STATUS_LABEL[s.status],
    ].join(','),
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `settlements_${from || 'all'}_${to || 'all'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SettlementsPage() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<SettlementTab>('daily');

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const today = new Date().toISOString().split('T')[0];
  const todayLabel = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  const fetchSummary = useCallback(async () => {
    if (!storeId || !token) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const res = await apiFetch(`/stores/${storeId}/settlements/summary?date=${today}`, token);
      if (res.ok) {
        setSummary(await res.json());
      } else {
        const body = await res.text().catch(() => '');
        setSummaryError(`API 오류 ${res.status}: ${body || '알 수 없는 오류'}`);
      }
    } catch (e) {
      setSummaryError(`네트워크 오류: ${String(e)}`);
    } finally {
      setSummaryLoading(false);
    }
  }, [storeId, token, today]);

  const fetchSettlements = useCallback(
    async (f?: string, t?: string) => {
      if (!storeId || !token) return;
      setListLoading(true);
      setListError('');
      try {
        const params = new URLSearchParams();
        if (f) params.set('from', f);
        if (t) params.set('to', t);
        const res = await apiFetch(`/stores/${storeId}/settlements?${params.toString()}`, token);
        if (res.ok) {
          const data = await res.json();
          setSettlements(data.settlements);
        } else {
          setListError('조회에 실패했습니다');
        }
      } finally {
        setListLoading(false);
      }
    },
    [storeId, token],
  );

  useEffect(() => {
    if (activeTab === 'daily') fetchSummary();
    if (activeTab === 'orders') fetchSettlements();
  }, [activeTab, fetchSummary, fetchSettlements]);

  const TABS = [
    { key: 'daily' as SettlementTab, label: '일별 요약' },
    { key: 'period' as SettlementTab, label: '기간별 조회' },
    { key: 'orders' as SettlementTab, label: '주문별 상세' },
  ];

  return (
    <Box
      component="main"
      style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface-muted)' }}
    >
      <Box
        component="header"
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          padding: '16px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Title order={3}>정산 관리</Title>
        </Container>
      </Box>

      <Box
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky',
          top: 57,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group gap={0}>
            {TABS.map((tab) => (
              <UnstyledButton
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  fontSize: 14,
                  fontWeight: 500,
                  textAlign: 'center',
                  borderBottom: `2px solid ${activeTab === tab.key ? 'var(--color-primary)' : 'transparent'}`,
                  color:
                    activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                }}
              >
                {tab.label}
              </UnstyledButton>
            ))}
          </Group>
        </Container>
      </Box>

      <Container size="sm" px="md" py="md">
        {/* 일별 요약 */}
        {activeTab === 'daily' && (
          <Paper radius="lg" p="lg" shadow="xs">
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              mb="md"
            >
              {todayLabel}
            </Text>
            {summaryLoading ? (
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                ta="center"
                py="md"
              >
                불러오는 중...
              </Text>
            ) : summaryError ? (
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                ta="center"
                py="md"
              >
                {summaryError}
              </Text>
            ) : (
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    완료 건수
                  </Text>
                  <Text style={{ fontWeight: 'var(--fw-medium)' }}>{summary?.count ?? 0}건</Text>
                </Group>
                <Group justify="space-between">
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    총 매출
                  </Text>
                  <Text style={{ fontWeight: 'var(--fw-medium)' }}>
                    {toKRW(summary?.totalAmount ?? 0)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    플랫폼 수수료
                  </Text>
                  <Text
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                  >
                    −{toKRW(summary?.totalPlatformFee ?? 0)}
                  </Text>
                </Group>
                <Divider />
                <Group justify="space-between">
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-medium)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    정산 예정
                  </Text>
                  <Text style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-primary)' }}>
                    {toKRW(summary?.totalNetAmount ?? 0)}
                  </Text>
                </Group>
                {summary && summary.count > 0 && (
                  <SimpleGrid
                    cols={2}
                    mt="xs"
                    style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}
                  >
                    {(Object.entries(summary.byStatus) as [SettlementStatus, number][])
                      .filter(([, v]) => v > 0)
                      .map(([status, count]) => (
                        <Badge
                          key={status}
                          color={STATUS_COLOR[status]}
                          variant="light"
                          radius="xl"
                        >
                          {STATUS_LABEL[status]} {count}건
                        </Badge>
                      ))}
                  </SimpleGrid>
                )}
              </Stack>
            )}
          </Paper>
        )}

        {/* 기간별 조회 */}
        {activeTab === 'period' && (
          <Stack gap="md">
            <Paper radius="lg" p="lg" shadow="xs">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                mb="md"
              >
                조회 기간을 선택하세요
              </Text>
              <Group gap="xs" mb="md">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    fontSize: 14,
                  }}
                />
                <Text style={{ color: 'var(--color-text-disabled)' }}>~</Text>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    fontSize: 14,
                  }}
                />
              </Group>
              <Button
                onClick={() => fetchSettlements(from, to)}
                disabled={listLoading}
                fullWidth
                size="md"
                radius="xl"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {listLoading ? '조회 중...' : '조회'}
              </Button>
            </Paper>

            {listError && (
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                ta="center"
              >
                {listError}
              </Text>
            )}

            {settlements.length > 0 && (
              <Stack gap="xs">
                <Group justify="space-between" px={4}>
                  <Text
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                  >
                    {settlements.length}건 조회됨
                  </Text>
                  <UnstyledButton
                    onClick={() => downloadCSV(settlements, from, to)}
                    style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 500 }}
                  >
                    CSV 다운로드
                  </UnstyledButton>
                </Group>
                {settlements.map((s) => (
                  <Paper key={s.id} radius="md" px="md" py="sm" shadow="xs">
                    <Group justify="space-between" mb={4}>
                      <Text
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-disabled)',
                        }}
                      >
                        {s.orderId.slice(0, 8)}…
                      </Text>
                      <Badge color={STATUS_COLOR[s.status]} variant="light" size="xs" radius="xl">
                        {STATUS_LABEL[s.status]}
                      </Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {toDateStr(s.settledAt._seconds)}
                      </Text>
                      <Text style={{ fontWeight: 'var(--fw-medium)' }}>{toKRW(s.netAmount)}</Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}
          </Stack>
        )}

        {/* 주문별 상세 */}
        {activeTab === 'orders' && (
          <Box>
            {listLoading ? (
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                ta="center"
                py={80}
              >
                불러오는 중...
              </Text>
            ) : settlements.length === 0 ? (
              <Stack
                align="center"
                justify="center"
                py={80}
                style={{ color: 'var(--color-text-disabled)' }}
              >
                <Text style={{ fontSize: 'var(--font-size-sm)' }}>정산 완료된 주문이 없습니다</Text>
              </Stack>
            ) : (
              <Stack gap="xs">
                <Group justify="flex-end" px={4}>
                  <UnstyledButton
                    onClick={() => downloadCSV(settlements, '', '')}
                    style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 500 }}
                  >
                    CSV 다운로드
                  </UnstyledButton>
                </Group>
                {settlements.map((s) => (
                  <Paper key={s.id} radius="md" px="md" py="sm" shadow="xs">
                    <Group justify="space-between" mb={4}>
                      <Text
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-disabled)',
                        }}
                      >
                        {s.orderId.slice(0, 8)}…
                      </Text>
                      <Badge color={STATUS_COLOR[s.status]} variant="light" size="xs" radius="xl">
                        {STATUS_LABEL[s.status]}
                      </Badge>
                    </Group>
                    <Group justify="space-between">
                      <Stack gap={0}>
                        <Text
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          {toDateStr(s.settledAt._seconds)}
                        </Text>
                        <Text
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-disabled)',
                          }}
                        >
                          수수료 {toKRW(s.platformFee)}
                        </Text>
                      </Stack>
                      <Text style={{ fontWeight: 'var(--fw-medium)' }}>{toKRW(s.netAmount)}</Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
        )}
      </Container>
    </Box>
  );
}
