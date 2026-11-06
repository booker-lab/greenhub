// 관리자 메뉴 묶음·현재 메뉴 판정·할 일 수 표기 — 순수 함수(vitest에서 '@/' alias 없이 검증한다).
// 묶음과 할 일 수 규칙은 design-direction.md §5 어드민 "틀"(D7)을 따른다.

/** 메뉴 오른쪽에 처리할 일의 수를 붙이는 메뉴. */
export type AdminTodoKey = 'orders' | 'settlements' | 'drivers';

export interface AdminNavItem {
  href: string;
  label: string;
  todo?: AdminTodoKey;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

/** 사이드바는 할 일 순서로 묶는다. 기능 토글이 꺼진 메뉴는 숨긴다(토글 값은 서버 레이아웃이 읽어 넘긴다). */
export function buildAdminNavGroups(features: {
  partnerInquiry: boolean;
  reviews: boolean;
}): AdminNavGroup[] {
  return [
    {
      label: '오늘 할 일',
      items: [
        { href: '/admin/orders', label: '주문', todo: 'orders' },
        { href: '/admin/settlements', label: '정산', todo: 'settlements' },
        { href: '/admin/drivers', label: '기사', todo: 'drivers' },
      ],
    },
    {
      label: '사람과 가게',
      items: [
        { href: '/admin/stores', label: '판매자' },
        { href: '/admin/users', label: '소비자' },
        { href: '/admin/invite', label: '초대' },
        ...(features.partnerInquiry
          ? [{ href: '/admin/partner-inquiries', label: '입점 문의' }]
          : []),
      ],
    },
    {
      label: '기록과 설정',
      items: [
        { href: '/admin/banner', label: '배너' },
        ...(features.reviews ? [{ href: '/admin/reviews', label: '후기' }] : []),
        { href: '/admin/audit', label: '감사 기록' },
      ],
    },
  ];
}

/** 현재 주소가 그 메뉴이거나 그 아래 화면이면 현재 메뉴다(`/admin/orders`와 `/admin/ordersx`는 구분). */
export function isAdminNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 할 일 수 하나. `more`는 한 번에 받은 범위 밖에도 더 있을 수 있다는 뜻이다.
 * 조회 전·실패는 null로 두고 숫자를 쓰지 않는다(모르는 값을 0으로 쓰지 않는다).
 */
export interface AdminTodoCount {
  count: number;
  more: boolean;
}

export type AdminTodoCounts = Partial<Record<AdminTodoKey, AdminTodoCount | null>>;

/** 배송 보류처럼 문제 상태를 세는 메뉴는 빨강, 나머지는 검정이다. */
export const ADMIN_TODO_PROBLEM: Record<AdminTodoKey, boolean> = {
  orders: true,
  settlements: false,
  drivers: false,
};

/** 할 일 수 표기. 단위는 모두 "건"이고(2026-11-01 사용자 결정), 할 일이 없거나 모르면 쓰지 않는다. */
export function formatAdminTodoCount(value: AdminTodoCount | null | undefined): string | null {
  if (!value || value.count <= 0) return null;
  return `${value.count}건${value.more ? '+' : ''}`;
}
