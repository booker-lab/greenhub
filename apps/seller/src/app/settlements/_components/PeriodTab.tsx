'use client';

import { Button } from '@greenhub/ui/components/button';
import type { Settlement } from '../_constants';
import { downloadCSV } from '../_lib';
import { LoadMoreSettlements } from './LoadMoreSettlements';
import { SettlementListItem } from './SettlementListItem';

interface PeriodTabProps {
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  settlements: Settlement[];
  listLoading: boolean;
  listError: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string;
  onSearch: (f: string, t: string) => void;
  onLoadMore: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Stack·Paper(radius lg·p lg·shadow xs)·Group·Text·UnstyledButton,
// Button size md(radius xl, 꽉 찬 폭)와 같은 값.
const TEXT = 'm-0 p-0 text-base';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

export function PeriodTab({
  from,
  setFrom,
  to,
  setTo,
  settlements,
  listLoading,
  listError,
  hasMore,
  loadingMore,
  loadMoreError,
  onSearch,
  onLoadMore,
}: PeriodTabProps) {
  return (
    <div className="flex flex-col items-stretch justify-start gap-4">
      <div className="block rounded-[16px] bg-white p-5 shadow-mantine-xs">
        <p
          className={`${TEXT} mb-4`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          조회 기간을 선택하세요
        </p>
        {/* 두 날짜 칸이 한 줄에 나란히 오게(좁은 화면에서 줄바꿈되며 "~"만 남던 문제) */}
        <div className="mb-4 flex flex-row flex-nowrap items-center justify-start gap-2.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 10px',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              fontSize: 'var(--font-size-sm)',
              fontVariantNumeric: 'tabular-nums',
            }}
          />
          <p className={TEXT} style={{ color: 'var(--color-text-disabled)' }}>
            ~
          </p>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 10px',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              fontSize: 'var(--font-size-sm)',
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        </div>
        <Button
          onClick={() => onSearch(from, to)}
          disabled={listLoading}
          size="md"
          className="w-full"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {listLoading ? '조회 중...' : '조회'}
        </Button>
      </div>

      {listError && (
        <p
          className={`${TEXT} text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {listError}
        </p>
      )}

      {settlements.length > 0 && (
        <div className="flex flex-col items-stretch justify-start gap-2.5">
          <div className="flex flex-row flex-wrap items-center justify-between gap-4 px-1">
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {settlements.length}건 조회됨{hasMore ? ' (더 있음)' : ''}
            </p>
            <button
              type="button"
              className={UNSTYLED_BUTTON}
              onClick={() => downloadCSV(settlements, from, to)}
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-primary-dark)',
                fontWeight: 500,
              }}
            >
              CSV 다운로드
            </button>
          </div>
          {settlements.map((s) => (
            <SettlementListItem key={s.id} settlement={s} />
          ))}
          {hasMore && (
            <LoadMoreSettlements
              loadedCount={settlements.length}
              loadingMore={loadingMore}
              error={loadMoreError}
              onLoadMore={onLoadMore}
            />
          )}
        </div>
      )}
    </div>
  );
}
