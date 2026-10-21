'use client';

import { Paper, SimpleGrid, Text } from '@mantine/core';
import type { AdminSettlementsSummary } from '@/hooks/useAdmin';
import { toKRW } from '../_lib';

interface SummaryCardsProps {
  /** 같은 조건 전체의 서버 합계(목록 "더 보기"와 무관). */
  summary: AdminSettlementsSummary | null;
  loading: boolean;
  error: string | null;
}

const labelStyle = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' };
const valueStyle = { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--fw-bold)' };

function Card({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Paper radius="lg" style={{ border: '1px solid var(--color-border)' }} p="md">
      <Text style={labelStyle} mb={4}>
        {label}
      </Text>
      <Text style={{ ...valueStyle, ...(color ? { color } : {}) }}>{value}</Text>
      {sub && (
        <Text style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}>
          {sub}
        </Text>
      )}
    </Paper>
  );
}

/** 지급 대기(confirmed)·지급 완료(paid)·수수료(confirmed+paid)·회수 필요 합계. 서버가 조건 전체로 계산한다. */
export function SummaryCards({ summary, loading, error }: SummaryCardsProps) {
  if (error !== null && !loading) {
    return (
      <Text mb="md" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
        합계를 불러오지 못했습니다. ({error})
      </Text>
    );
  }
  if (!summary) return null;
  const pending = loading ? '…' : undefined;
  return (
    <>
      <SimpleGrid cols={{ base: 2, sm: summary.recovery.count > 0 ? 4 : 3 }} mb="md">
        <Card
          label="지급 대기"
          value={pending ?? toKRW(summary.payable.netAmount)}
          sub={`${summary.payable.count}건 · 확정`}
          color="var(--color-primary-dark)"
        />
        <Card
          label="지급 완료"
          value={pending ?? toKRW(summary.paid.netAmount)}
          sub={`${summary.paid.count}건`}
        />
        <Card
          label="플랫폼 수수료"
          value={pending ?? toKRW(summary.platformFee)}
          sub="지급 대기 + 지급 완료"
        />
        {summary.recovery.count > 0 && (
          <Card
            label="판매자 회수 필요"
            value={pending ?? toKRW(summary.recovery.amount)}
            sub={`${summary.recovery.count}건 · 지급 뒤 환불`}
            color="var(--color-danger)"
          />
        )}
      </SimpleGrid>
      {summary.truncated && (
        <Text mb="sm" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>
          정산이 너무 많아 합계가 일부만 계산됐습니다. 기간이나 가게를 좁혀 주세요.
        </Text>
      )}
    </>
  );
}
