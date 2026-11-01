'use client';

import { LoadingButton } from '@greenhub/ui/components/loading-button';

interface LoadMoreButtonProps {
  loadedCount: number;
  loadingMore: boolean;
  error: string;
  onLoadMore: () => void;
}

// ② 방향(D7): 브랜드 색은 로고와 주요 버튼 하나에만 쓰므로 "더 보기"는 회색(secondary)이다(어드민 LoadMoreFooter와 같음).
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
        {loadedCount}건까지 불러왔습니다. 합계는 조건 전체 기준이고, 계좌 없음·지급 보류와 가게별
        묶음은 불러온 행 기준입니다.
      </p>
      {error && (
        <p
          className={`${TEXT} text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {error}
        </p>
      )}
      <LoadingButton
        measured
        variant="secondary"
        onClick={onLoadMore}
        loading={loadingMore}
        className="rounded-[8px]"
      >
        더 보기
      </LoadingButton>
    </div>
  );
}
