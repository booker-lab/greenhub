'use client';

import { LoadingButton } from '@greenhub/ui/components/loading-button';

interface LoadMoreButtonProps {
  loadedCount: number;
  loadingMore: boolean;
  error: string;
  onLoadMore: () => void;
}

// ① 외형 유지(UI 교체 P2b): Mantine Stack(gap 6·가운데·py sm)·Text·Button light size sm과 같은 값.
// 불러오는 중은 LoadingButton measured(Mantine Button loading 실측 모양, #718)다.
const TEXT = 'm-0 p-0 text-base';

/** 판매자 정산 LoadMoreSettlements와 같은 모양. 서버가 같은 조건의 정산이 더 있다고 알린 경우에만 보인다. */
export function LoadMoreButton({
  loadedCount,
  loadingMore,
  error,
  onLoadMore,
}: LoadMoreButtonProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-3">
      <p
        className={`${TEXT} text-center`}
        style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}
      >
        {loadedCount}건까지 불러왔습니다. 합계 카드는 조건 전체 기준입니다.
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
