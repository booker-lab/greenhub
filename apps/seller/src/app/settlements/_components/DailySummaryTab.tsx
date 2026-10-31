'use client';

import { Badge } from '@greenhub/ui/components/badge';
import type { SettlementStatus, Summary } from '../_constants';
import { STATUS_COLOR, STATUS_LABEL } from '../_constants';
import { toKRW } from '../_lib';
import { LIGHT_BADGE } from './status-badge';

interface DailySummaryTabProps {
  selectedDate: string;
  setSelectedDate: (v: string) => void;
  selectedDateLabel: string;
  today: string;
  summary: Summary | null;
  summaryLoading: boolean;
  summaryError: string;
}

// ① 외형 유지(UI 교체 P4): Mantine Paper(radius lg·p lg·shadow xs)·Group·Stack(gap sm)·Text·
// SimpleGrid(2열·간격 md)·Badge light radius xl과 같은 값.
const TEXT = 'm-0 p-0 text-base';
const ROW = 'flex flex-row flex-wrap items-center justify-between gap-4';

export function DailySummaryTab({
  selectedDate,
  setSelectedDate,
  selectedDateLabel,
  today,
  summary,
  summaryLoading,
  summaryError,
}: DailySummaryTabProps) {
  return (
    <div className="block rounded-[16px] bg-white p-5 shadow-mantine-xs">
      <div className={`${ROW} mb-4`}>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {selectedDateLabel}
        </p>
        <input
          type="date"
          value={selectedDate}
          max={today}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{
            padding: '6px 10px',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
        />
      </div>
      {summaryLoading ? (
        <p
          className={`${TEXT} py-4 text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          불러오는 중...
        </p>
      ) : summaryError ? (
        <p
          className={`${TEXT} py-4 text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {summaryError}
        </p>
      ) : (
        <div className="flex flex-col items-stretch justify-start gap-3">
          <div className={ROW}>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              완료 건수
            </p>
            <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
              {summary?.count ?? 0}건
            </p>
          </div>
          <div className={ROW}>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              총 매출
            </p>
            <p className={TEXT} style={{ fontWeight: 'var(--fw-medium)' }}>
              {toKRW(summary?.totalAmount ?? 0)}
            </p>
          </div>
          <div className={ROW}>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              플랫폼 수수료
            </p>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              −{toKRW(summary?.totalPlatformFee ?? 0)}
            </p>
          </div>
          {/* 디자인 기준 §5: 판매자 요약 숫자는 연두 상자 */}
          <div
            className={`${ROW} p-4`}
            style={{
              background: 'var(--color-primary-surface)',
              borderRadius: 'var(--radius-tag)',
            }}
          >
            <p
              className={TEXT}
              style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
            >
              정산 예정
            </p>
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-xl)',
                fontWeight: 'var(--fw-extrabold)',
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--color-primary-dark)',
              }}
            >
              {toKRW(summary?.totalNetAmount ?? 0)}
            </p>
          </div>
          {summary && summary.count > 0 && (
            <div
              className="mt-2.5 grid grid-cols-2 gap-4"
              style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}
            >
              {(Object.entries(summary.byStatus) as [SettlementStatus, number][])
                .filter(([, v]) => v > 0)
                .map(([status, count]) => (
                  <Badge
                    key={status}
                    variant={LIGHT_BADGE[STATUS_COLOR[status]] ?? 'secondary'}
                    className="rounded-[32px]"
                  >
                    {STATUS_LABEL[status]} {count}건
                  </Badge>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
