'use client';

import type { AdminSettlementsSummary } from '@/hooks/useAdmin';
import { toKRW } from '../_lib';

interface SummaryCardsProps {
  /** 같은 조건 전체의 서버 합계(목록 "더 보기"와 무관). */
  summary: AdminSettlementsSummary | null;
  loading: boolean;
  error: string | null;
}

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Paper(흰 면, radius lg, p md)·SimpleGrid(간격 md, sm = 48em) 값.
const TEXT = 'm-0 p-0 text-base';

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
    // biome-ignore lint/a11y/useSemanticElements: 입력 묶음(fieldset)이 아닌 합계 카드다. 로컬 E2E가 role group 이름으로 찾는다.
    <div
      role="group"
      aria-label={label}
      className="block rounded-[16px] bg-white p-4"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <p className={`${TEXT} mb-1`} style={labelStyle}>
        {label}
      </p>
      <p className={TEXT} style={{ ...valueStyle, ...(color ? { color } : {}) }}>
        {value}
      </p>
      {sub && (
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

/** 지급 대기(confirmed)·지급 완료(paid)·수수료(confirmed+paid)·회수 필요 합계. 서버가 조건 전체로 계산한다. */
export function SummaryCards({ summary, loading, error }: SummaryCardsProps) {
  if (error !== null && !loading) {
    return (
      <p
        className={`${TEXT} mb-4`}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
      >
        합계를 불러오지 못했습니다. ({error})
      </p>
    );
  }
  if (!summary) return null;
  const pending = loading ? '…' : undefined;
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: 입력 묶음(fieldset)이 아닌 합계 카드 묶음이다. 로컬 E2E가 role group 이름으로 찾는다. */}
      <div
        role="group"
        aria-label="정산 합계"
        className={`mb-4 grid grid-cols-2 gap-4 ${
          summary.recovery.count > 0 ? 'min-[48em]:grid-cols-4' : 'min-[48em]:grid-cols-3'
        }`}
      >
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
      </div>
      {summary.truncated && (
        <p
          className={`${TEXT} mb-3`}
          style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}
        >
          정산이 너무 많아 합계가 일부만 계산됐습니다. 기간이나 가게를 좁혀 주세요.
        </p>
      )}
    </>
  );
}
