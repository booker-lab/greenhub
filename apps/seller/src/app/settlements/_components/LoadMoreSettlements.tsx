'use client';

import { LoadingButton } from '@greenhub/ui/components/loading-button';

interface LoadMoreSettlementsProps {
  loadedCount: number;
  loadingMore: boolean;
  error: string;
  onLoadMore: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Stack(gap 6·가운데·py sm)·Text·Button light size sm과 같은 값.
// 불러오는 중은 LoadingButton measured(Mantine Button loading 실측 모양, #718)다.
const TEXT = 'm-0 p-0 text-base';

/** 서버가 같은 조건의 정산이 더 있다고 알려 준 경우에만 보인다. 불러온 범위와 CSV 범위를 함께 알린다. */
export function LoadMoreSettlements({
  loadedCount,
  loadingMore,
  error,
  onLoadMore,
}: LoadMoreSettlementsProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-3">
      <p
        className={`${TEXT} text-center`}
        style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}
      >
        {loadedCount}건까지 불러왔습니다. 정산이 더 있으며, CSV에는 불러온 건만 담깁니다.
      </p>
      {error && (
        <p
          className={`${TEXT} text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {error}
        </p>
      )}
      <LoadingButton measured variant="light" onClick={onLoadMore} loading={loadingMore}>
        더 보기
      </LoadingButton>
    </div>
  );
}
