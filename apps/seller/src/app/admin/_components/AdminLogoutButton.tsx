'use client';

import { UnstyledButton } from '@mantine/core';
import { logout } from '@/lib/logout';

// 순수 관리자는 판매자 설정 화면(로그아웃 위치)에 갈 수 없으므로 관리자 콘솔 헤더에서 로그아웃한다.
export function AdminLogoutButton() {
  return (
    <UnstyledButton
      onClick={() => void logout()}
      style={{
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--color-text-secondary)',
      }}
    >
      로그아웃
    </UnstyledButton>
  );
}
