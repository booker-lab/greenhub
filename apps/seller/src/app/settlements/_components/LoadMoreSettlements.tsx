'use client';

import { Button } from '@greenhub/ui/components/button';
import { Loader } from '@greenhub/ui/components/loader';
import type { CSSProperties } from 'react';

interface LoadMoreSettlementsProps {
  loadedCount: number;
  loadingMore: boolean;
  error: string;
  onLoadMore: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Stack(gap 6·가운데·py sm)·Text·Button light size sm과 같은 값.
// 불러오는 중 모양은 어드민 정산 LoadMoreButton과 같다. Mantine Button loading처럼 면색을 그대로 두고 글자를
// 숨긴 채, 흐린 흰 덮개(15%·blur 12px) 위 가운데에 20px(높이 ÷ 1.8) 원을 돌린다.
const TEXT = 'm-0 p-0 text-base';
const LOADING =
  "disabled:bg-[#d2f2df] disabled:text-[#005c32] before:pointer-events-none before:absolute before:inset-[-1px] before:rounded-xl before:bg-white/15 before:blur-[12px] before:content-[''] [&_[data-slot=button-label]]:translate-y-full [&_[data-slot=button-label]]:opacity-0";

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
      <Button
        variant="light"
        onClick={onLoadMore}
        disabled={loadingMore}
        data-loading={loadingMore || undefined}
        className={loadingMore ? LOADING : undefined}
      >
        {loadingMore && (
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 [transform:translate(-50%,calc(-50%+1px))] will-change-transform"
          >
            <Loader
              color="#005c32"
              style={{ '--loader-size': '20px', '--loader-border': '2.5px' } as CSSProperties}
            />
          </span>
        )}
        더 보기
      </Button>
    </div>
  );
}
