'use client';

import { Button } from '@greenhub/ui/components/button';

interface AdminFetchErrorProps {
  /** 예: '숨긴 후기를 불러오지 못했습니다.' */
  title: string;
  /** 예: '숨긴 후기 조회 중 오류 발생' */
  detail: string;
  onRetry: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Paper(radius lg 16px·shadow xs·흰 면)·Stack(gap sm 12·가운데·py 64·px md)·
// Text·Button outline radius md(8px)와 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';

// 관리자 탭 조회 실패 화면 — 정산·소비자 탭과 같은 모양(제목·상세·다시 조회).
// 조회 실패를 빈 목록("없어요")으로 보여 주지 않기 위해 쓴다.
export function AdminFetchError({ title, detail, onRetry }: AdminFetchErrorProps) {
  return (
    <div
      className="block rounded-[16px] bg-white shadow-mantine-xs"
      style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
    >
      <div className="flex flex-col items-center justify-start gap-3 px-4 py-16">
        <p className={TEXT} style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
          {title}
        </p>
        <p
          className={`${TEXT} text-center`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {detail}
        </p>
        <Button onClick={onRetry} variant="outline" className="rounded-[8px]">
          다시 조회
        </Button>
      </div>
    </div>
  );
}
