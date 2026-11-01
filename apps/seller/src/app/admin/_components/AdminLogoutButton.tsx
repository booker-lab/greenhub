'use client';

import { logout } from '@/lib/logout';

// 순수 관리자는 판매자 설정 화면(로그아웃 위치)에 갈 수 없으므로 어드민 상단바에서 로그아웃한다.
export function AdminLogoutButton() {
  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="min-h-11 cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm text-foreground"
    >
      로그아웃
    </button>
  );
}
