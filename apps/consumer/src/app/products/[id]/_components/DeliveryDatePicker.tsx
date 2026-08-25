'use client';

import { useState } from 'react';
import { todayKST } from '@greenhub/shared';
import { ActionIcon, Box, Group, Paper, SimpleGrid, Text } from '@mantine/core';
import { useDeliverySlots } from '@/hooks/useDailyCap';

interface Props {
  storeId: string | null;
  /** 선택된 배송일 'YYYY-MM-DD' — 미선택 시 null */
  value: string | null;
  onChange: (date: string) => void;
}

/** 'YYYY-MM-DD' 문자열 생성 */
function toDateStr(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** 해당 월의 주 단위 날짜 그리드 (앞쪽 빈칸은 null) */
function buildCalendar(year: number, month: number): (string | null)[][] {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = Array(firstDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    week.push(toDateStr(year, month, d));
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

/**
 * 소비자 배송일 선택 캘린더 — 셀러 `daily-caps` 캘린더의 거울상.
 * 셀러가 슬롯(totalCap)을 연 날짜 중 잔여(totalCap - usedSlots)가 남은
 * 날짜만 선택 가능. 과거·문서 없음·마감(잔여 0) 날짜는 disabled.
 * 월 이동은 당월 + 익월 2개월로 제한.
 */
export default function DeliveryDatePicker({ storeId, value, onChange }: Props) {
  const todayStr = todayKST();
  const [todayYear, todayMonth] = todayStr.split('-').map(Number);
  // 0 = 당월, 1 = 익월
  const [monthOffset, setMonthOffset] = useState(0);

  const viewYear = todayYear + Math.floor((todayMonth - 1 + monthOffset) / 12);
  const viewMonth = (todayMonth - 1 + monthOffset) % 12;

  // 당월 1일 ~ 익월 말일 범위를 한 번에 구독 (월 이동 시 재쿼리 불필요)
  const from = toDateStr(todayYear, todayMonth - 1, 1);
  const toMonthDate = new Date(Date.UTC(todayYear, todayMonth + 1, 0));
  const to = toDateStr(
    toMonthDate.getUTCFullYear(),
    toMonthDate.getUTCMonth(),
    toMonthDate.getUTCDate(),
  );

  const { slots, loading } = useDeliverySlots(storeId, from, to);

  const calendar = buildCalendar(viewYear, viewMonth);
  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
  });

  return (
    <Paper radius="md" p="md" mb="md" style={{ background: 'var(--color-surface-muted)' }}>
      <Text
        style={{
          fontWeight: 'var(--fw-bold)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text)',
        }}
        mb="sm"
      >
        배송 희망일
      </Text>

      {/* 월 이동 */}
      <Group justify="space-between" mb="sm">
        <ActionIcon
          variant="subtle"
          color="gray"
          disabled={monthOffset === 0}
          onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
          aria-label="이전 달"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </ActionIcon>
        <Text style={{ fontWeight: 'var(--fw-medium)' }}>{monthLabel}</Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          disabled={monthOffset === 1}
          onClick={() => setMonthOffset((o) => Math.min(1, o + 1))}
          aria-label="다음 달"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            focusable="false"
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
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            불러오는 중...
          </Text>
        </Box>
      ) : (
        calendar.map((week, wi) => (
          <SimpleGrid key={wi} cols={7}>
            {week.map((date, di) => {
              if (!date) return <Box key={di} />;
              const slot = slots[date];
              const isPast = date < todayStr;
              // 슬롯 미설정(문서 없음)·과거·잔여 0 → 선택 불가
              const available = !isPast && !!slot && slot.remainingSlots > 0;
              const isSelected = date === value;
              return (
                <Box
                  key={date}
                  component="button"
                  type="button"
                  disabled={!available}
                  onClick={() => available && onChange(date)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '6px 0',
                    border: 'none',
                    borderRadius: 12,
                    opacity: available ? 1 : 0.35,
                    cursor: available ? 'pointer' : 'not-allowed',
                    background: isSelected ? 'var(--color-primary)' : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-medium)',
                      color: isSelected
                        ? 'var(--color-surface)'
                        : 'var(--color-text-secondary)',
                    }}
                  >
                    {parseInt(date.split('-')[2], 10)}
                  </Text>
                  <Text
                    mt={2}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: available ? 'var(--fw-medium)' : undefined,
                      color: isSelected
                        ? 'var(--color-surface)'
                        : available
                          ? 'var(--color-status-info-text)'
                          : 'var(--color-text-disabled)',
                    }}
                  >
                    {slot && available ? `${slot.remainingSlots}석` : '—'}
                  </Text>
                </Box>
              );
            })}
          </SimpleGrid>
        ))
      )}

      <Text
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        mt="xs"
      >
        {value
          ? `선택: ${new Date(`${value}T00:00:00+09:00`).toLocaleDateString('ko-KR', {
              timeZone: 'Asia/Seoul',
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}`
          : '배송 가능한 날짜를 선택해 주세요'}
      </Text>
    </Paper>
  );
}
