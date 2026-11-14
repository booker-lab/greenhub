'use client';

import { AppButton } from '@/components/app-button';

/** 오프라인 대체 화면의 "다시 열기". 홈 화면 앱(iOS)은 오류 화면에 새로고침이 없어 화면 안에 둔다. */
export function ReopenButton() {
  return (
    <AppButton size="xl" onClick={() => window.location.reload()}>
      다시 열기
    </AppButton>
  );
}
