'use client';

import { useState, useEffect, useCallback } from 'react';
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
  SimpleGrid,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';

interface DailyCap {
  date: string;
  totalCap: number;
  usedSlots?: number;
}

function buildCalendar(year: number, month: number): (string | null)[][] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = Array(firstDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    week.push(`${year}-${mm}-${dd}`);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

export default function DailyCapsPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [caps, setCaps] = useState<Record<string, DailyCap>>({});
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const fetchCaps = useCallback(async () => {
    if (!storeId || !token) return;
    setLoading(true);
    const mm = String(month + 1).padStart(2, '0');
    const from = `${year}-${mm}-01`;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;
    try {
      const res = await apiFetch(`/stores/${storeId}/daily-caps?from=${from}&to=${to}`, token);
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, DailyCap> = {};
        for (const cap of data.caps) map[cap.date] = cap;
        setCaps(map);
      }
    } finally {
      setLoading(false);
    }
  }, [storeId, token, year, month]);

  useEffect(() => {
    fetchCaps();
  }, [fetchCaps]);

  function prevMonth() {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
  }

  function startEdit(date: string) {
    setEditing(date);
    setEditValue(String(caps[date]?.totalCap ?? 0));
  }

  async function saveCap(date: string) {
    if (!storeId || !token) return;
    const totalCap = parseInt(editValue, 10);
    if (Number.isNaN(totalCap) || totalCap < 0) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/stores/${storeId}/daily-caps/${date}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ totalCap }),
      });
      if (res.ok) {
        setCaps((prev) => ({ ...prev, [date]: { ...prev[date], date, totalCap } }));
        setEditing(null);
      }
    } finally {
      setSaving(false);
    }
  }

  const calendar = buildCalendar(year, month);
  const todayStr = now.toISOString().split('T')[0];
  const monthLabel = new Date(year, month).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
  });

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
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </ActionIcon>
          <Title order={2} style={{ fontSize: 'var(--font-size-xl)' }}>
            배송 슬롯 설정
          </Title>
        </Group>

        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
            lineHeight: 1.6,
          }}
          mb="md"
        >
          날짜를 탭하면 해당 날짜의 최대 배송 슬롯(총 수량)을 설정할 수 있습니다.
        </Text>

        {/* 월 이동 */}
        <Paper radius="lg" shadow="sm" p="md" mb="md">
          <Group justify="space-between" mb="md">
            <ActionIcon variant="subtle" color="gray" onClick={prevMonth}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </ActionIcon>
            <Text style={{ fontWeight: 'var(--fw-medium)' }}>{monthLabel}</Text>
            <ActionIcon variant="subtle" color="gray" onClick={nextMonth}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </ActionIcon>
          </Group>

          {/* 요일 헤더 */}
          <SimpleGrid cols={7} mb={4}>
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
              <Text
                key={d}
                ta="center"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                py={4}
              >
                {d}
              </Text>
            ))}
          </SimpleGrid>

          {/* 날짜 그리드 */}
          {loading ? (
            <Box py={32} style={{ textAlign: 'center' }}>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                불러오는 중...
              </Text>
            </Box>
          ) : (
            calendar.map((week, wi) => (
              <SimpleGrid key={wi} cols={7}>
                {week.map((date, di) => {
                  if (!date) return <Box key={di} />;
                  const cap = caps[date];
                  const isToday = date === todayStr;
                  const isPast = date < todayStr;
                  return (
                    <UnstyledButton
                      key={date}
                      onClick={() => !isPast && startEdit(date)}
                      disabled={isPast}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderRadius: 12,
                        opacity: isPast ? 0.4 : 1,
                        cursor: isPast ? 'not-allowed' : 'pointer',
                        backgroundColor: isToday ? 'var(--color-primary-surface)' : undefined,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: 'var(--fw-medium)',
                          color: isToday ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        }}
                      >
                        {parseInt(date.split('-')[2], 10)}
                      </Text>
                      <Text
                        mt={2}
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: cap ? 'var(--fw-medium)' : undefined,
                          color: cap
                            ? 'var(--color-status-info-text)'
                            : 'var(--color-text-disabled)',
                        }}
                      >
                        {cap ? cap.totalCap : '—'}
                      </Text>
                      {cap && (cap.usedSlots ?? 0) > 0 && (
                        <Text style={{ fontSize: 10, color: 'var(--color-text-disabled)' }}>
                          {cap.usedSlots}↑
                        </Text>
                      )}
                    </UnstyledButton>
                  );
                })}
              </SimpleGrid>
            ))
          )}
        </Paper>

        {/* 편집 패널 */}
        {editing && (
          <Paper radius="lg" shadow="sm" p="lg">
            <Text
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text)',
              }}
              mb="sm"
            >
              {editing} 슬롯 설정
            </Text>
            <Group align="center" gap="sm">
              <input
                type="number"
                min="0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 12,
                  fontSize: 14,
                  textAlign: 'right',
                }}
              />
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                개
              </Text>
            </Group>
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              mt={6}
            >
              0 = 해당일 배송 불가
            </Text>
            <Group gap="xs" mt="md">
              <Button
                onClick={() => setEditing(null)}
                flex={1}
                size="sm"
                radius="xl"
                variant="outline"
                color="gray"
              >
                취소
              </Button>
              <Button
                onClick={() => saveCap(editing)}
                disabled={saving}
                flex={1}
                size="sm"
                radius="xl"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {saving ? '저장 중...' : '저장'}
              </Button>
            </Group>
          </Paper>
        )}
      </Container>
    </Box>
  );
}
