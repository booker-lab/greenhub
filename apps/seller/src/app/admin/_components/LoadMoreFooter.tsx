'use client';

import { LoadingButton } from '@greenhub/ui/components/loading-button';

interface LoadMoreFooterProps {
  hasMore: boolean;
  loadingMore: boolean;
  /** 더 보기 실패 메시지. 목록은 그대로 두고 여기서 다시 시도한다. */
  moreError: string | null;
  onLoadMore: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Stack(가운데·gap 4·mt md)·Text·Button light gray(= secondary) radius md(8px)와 같은 값.
// 불러오는 중은 LoadingButton measured(Mantine Button loading 실측 모양, #718)다.

// 관리자 목록 공통 "더 보기" — 서버가 더 있다고 알릴 때만 보인다(주문·기사 탭 공용).
export function LoadMoreFooter({
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
}: LoadMoreFooterProps) {
  if (!hasMore) return null;
  return (
    <div className="mt-4 flex flex-col items-center gap-1">
      {moreError && (
        <p
          role="alert"
          className="m-0 p-0 text-base font-normal"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {moreError}
        </p>
      )}
      <LoadingButton
        measured
        variant="secondary"
        onClick={onLoadMore}
        loading={loadingMore}
        className="rounded-[8px]"
      >
        {moreError ? '다시 시도' : '더 보기'}
      </LoadingButton>
    </div>
  );
}
