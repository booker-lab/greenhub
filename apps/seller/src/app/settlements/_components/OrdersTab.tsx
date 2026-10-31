'use client';

import { useState } from 'react';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import type { Settlement, SettlementFilterKey, SettlementStatus } from '../_constants';
import { SETTLEMENT_FILTER_TABS } from '../_constants';
import { downloadCSV } from '../_lib';
import { LoadMoreSettlements } from './LoadMoreSettlements';
import { SettlementListItem } from './SettlementListItem';

interface OrdersTabProps {
  settlements: Settlement[];
  listLoading: boolean;
  // status 필터 fetch 배선(T3). 'all' → status 미전달(전체 조회, 기존 동작 유지).
  fetchSettlements: (f?: string, t?: string, status?: SettlementStatus) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string;
  onLoadMore: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Stack(gap xs)·Text·Box·Group·UnstyledButton과 같은 값.
const TEXT = 'm-0 p-0 text-base';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

export function OrdersTab({
  settlements,
  listLoading,
  fetchSettlements,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: OrdersTabProps) {
  const [activeStatus, setActiveStatus] = useState<SettlementFilterKey>('all');

  const handleChange = (key: SettlementFilterKey) => {
    setActiveStatus(key);
    fetchSettlements(undefined, undefined, key === 'all' ? undefined : key);
  };

  return (
    <div className="flex flex-col items-stretch justify-start gap-2.5">
      <SegmentedTabs<SettlementFilterKey>
        tabs={SETTLEMENT_FILTER_TABS}
        value={activeStatus}
        onChange={handleChange}
        layout="scroll"
      />

      {listLoading ? (
        <p
          className={`${TEXT} py-20 text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          불러오는 중...
        </p>
      ) : settlements.length === 0 ? (
        <div className="py-20" style={{ textAlign: 'center', color: 'var(--color-text-disabled)' }}>
          <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
            정산 완료된 주문이 없습니다
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-row flex-wrap items-center justify-end gap-4 px-1">
            <button
              type="button"
              className={UNSTYLED_BUTTON}
              onClick={() => downloadCSV(settlements, '', '')}
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
            <SettlementListItem key={s.id} settlement={s} showFee />
          ))}
          {hasMore && (
            <LoadMoreSettlements
              loadedCount={settlements.length}
              loadingMore={loadingMore}
              error={loadMoreError}
              onLoadMore={onLoadMore}
            />
          )}
        </>
      )}
    </div>
  );
}
