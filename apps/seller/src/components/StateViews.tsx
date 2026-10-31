'use client';

import { Loader } from '@greenhub/ui/components/loader';
import type { ReactNode } from 'react';

// ① 외형 유지(UI 교체 P4): Mantine Loader sm(22px, 주색)·Group(가운데·py 80)·Stack(gap md 16px)·Text와 같은 값.

/** 로딩 스피너. fullPage=true면 화면 전체 중앙 정렬. */
export function LoadingState({ fullPage = false }: { fullPage?: boolean }) {
  if (fullPage) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--color-surface-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader size="sm" />
      </div>
    );
  }
  return (
    <div className="flex flex-row flex-wrap items-center justify-center gap-4 py-20">
      <Loader size="sm" />
    </div>
  );
}

/** 빈 목록 안내 (아이콘 + 문구 + 선택 액션). */
export function EmptyState({
  icon,
  text,
  action,
}: {
  icon?: ReactNode;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-20"
      style={{ color: 'var(--color-text-disabled)' }}
    >
      {icon}
      <p className="m-0 p-0 font-normal" style={{ fontSize: 'var(--font-size-sm)' }}>
        {text}
      </p>
      {action}
    </div>
  );
}
