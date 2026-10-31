'use client';

import { logout } from '@/lib/logout';

// 순수 관리자는 판매자 설정 화면(로그아웃 위치)에 갈 수 없으므로 관리자 콘솔 헤더에서 로그아웃한다.
// ① 외형 유지(UI 교체 P4): Mantine UnstyledButton과 같은 값(글자 크기·굵기·색은 아래 style).
export function AdminLogoutButton() {
  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-inherit no-underline"
      style={{
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--color-text-secondary)',
      }}
    >
      로그아웃
    </button>
  );
}
