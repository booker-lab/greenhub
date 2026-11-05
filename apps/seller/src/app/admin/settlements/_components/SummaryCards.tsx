'use client';

import type { AdminSettlement, AdminSettlementsSummary } from '@/hooks/useAdmin';
import { summarizeLoadedBlocks, toWon } from '../_lib';

interface SummaryCardsProps {
  /** 같은 조건 전체의 서버 합계(목록 "더 보기"와 무관). */
  summary: AdminSettlementsSummary | null;
  loading: boolean;
  error: string | null;
  /** 불러온 정산 행 — 계좌 없음·지급 보류 칸은 서버 합계에 없어 이 행으로 계산한다(2026-11-01 사용자 결정). */
  loadedRows: readonly AdminSettlement[];
}

// ② 방향(design-direction.md §5 어드민 "정산"): 나눈 상자 하나의 무채색 숫자 띠. 아이콘·색 면 없이 글자로 쓴다.
// 첫 칸은 지급 대기(서버 합계, 확정 전부라 계좌 없음·보류를 포함한다고 밝힌다), 계좌가 없어 못 보내는 금액과 지급 보류는 따로 칸을 둔다(불러온 행 기준이라고 밝힌다).
// 칸 사이 선은 1px 간격 사이로 보이는 rule 바탕이다(휴대폰 2열·태블릿 3열·데스크톱 한 줄). 칸이 홀수면 마지막 칸이 두 칸을 차지한다.
// 회수할 금액만 빨강 숫자다(문제 상태). 보류에 호박색·노랑을 칠하지 않는다.

function Cell({
  label,
  value,
  sub,
  problem,
}: {
  label: string;
  value: string;
  sub?: string;
  problem?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 입력 묶음(fieldset)이 아닌 합계 칸이다. 로컬 E2E가 role group 이름으로 찾는다.
    <div
      role="group"
      aria-label={label}
      className="min-w-0 bg-card px-4 py-3 max-[640px]:px-3 [&:last-child:nth-child(odd)]:col-span-2 min-[1101px]:[&:last-child:nth-child(odd)]:col-span-1"
    >
      <p className="m-0 text-[13px] leading-[18px] text-[var(--color-text-secondary)]">{label}</p>
      <p
        className={`m-0 text-[18px] leading-[26px] font-bold tabular-nums ${problem ? 'text-destructive' : 'text-foreground'}`}
      >
        {value}
      </p>
      {sub && (
        <p className="m-0 text-[13px] leading-[18px] text-[var(--color-text-secondary)] [word-break:keep-all]">
          {sub}
        </p>
      )}
    </div>
  );
}

export function SummaryCards({ summary, loading, error, loadedRows }: SummaryCardsProps) {
  if (error !== null && !loading) {
    return (
      <p className="m-0 mb-4 text-[15px] text-destructive">합계를 불러오지 못했습니다. ({error})</p>
    );
  }
  if (!summary) return null;
  const pending = loading ? '…' : undefined;
  const loadedBasis = `불러온 ${loadedRows.length}건 기준`;
  const blocks = summarizeLoadedBlocks(loadedRows);
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: 입력 묶음(fieldset)이 아닌 합계 칸 묶음이다. 로컬 E2E가 role group 이름으로 찾는다. */}
      <div
        role="group"
        aria-label="정산 합계"
        className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-rule bg-rule min-[641px]:grid-cols-3 min-[1101px]:auto-cols-fr min-[1101px]:grid-flow-col min-[1101px]:grid-cols-none"
      >
        <Cell
          label="지급 대기"
          value={pending ?? toWon(summary.payable.netAmount)}
          sub={`${summary.payable.count}건 · 아래 두 칸 포함`}
        />
        <Cell
          label="계좌 없음"
          value={toWon(blocks.noAccount.netAmount)}
          sub={`${blocks.noAccount.count}건 · ${loadedBasis}`}
        />
        <Cell
          label="지급 보류"
          value={toWon(blocks.held.netAmount)}
          sub={`${blocks.held.count}건 · ${loadedBasis}`}
        />
        <Cell
          label="지급 완료"
          value={pending ?? toWon(summary.paid.netAmount)}
          sub={`${summary.paid.count}건`}
        />
        <Cell
          label="플랫폼 수수료"
          value={pending ?? toWon(summary.platformFee)}
          sub="지급 대기 + 지급 완료"
        />
        {summary.recovery.count > 0 && (
          <Cell
            label="회수할 금액"
            value={pending ?? toWon(summary.recovery.amount)}
            sub={`${summary.recovery.count}건 · 지급 뒤 환불`}
            problem
          />
        )}
      </div>
      {summary.truncated && (
        <p className="m-0 mb-3 text-[13px] text-destructive">
          정산이 너무 많아 합계가 일부만 계산됐습니다. 기간이나 가게를 좁혀 주세요.
        </p>
      )}
    </>
  );
}
