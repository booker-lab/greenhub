import type { AdminUser } from '@/hooks/useAdmin';

export type UserStatusFilter = 'all' | 'active' | 'suspended';
export type UserEmptyKind = 'no-data' | 'no-match' | 'has-data';

export interface UserFilters {
  keyword: string;
  status: UserStatusFilter;
}

export const DEFAULT_USER_STATUS_FILTER: UserStatusFilter = 'all';

export const USER_STATUS_TABS: { key: UserStatusFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '정상' },
  { key: 'suspended', label: '정지' },
];

function normalizeText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizePhone(value: string | undefined): string {
  return value?.replace(/-/g, '').trim() ?? '';
}

export function filterUsers(users: AdminUser[], filters: UserFilters): AdminUser[] {
  const keyword = filters.keyword.trim().toLowerCase();
  const phoneKeyword = normalizePhone(filters.keyword);

  return users.filter((user) => {
    const statusMatches =
      filters.status === 'all' ||
      (filters.status === 'suspended' ? user.suspended === true : user.suspended !== true);

    const keywordMatches =
      !keyword ||
      normalizeText(user.name).includes(keyword) ||
      normalizeText(user.email).includes(keyword) ||
      normalizePhone(user.phone).includes(phoneKeyword);

    return statusMatches && keywordMatches;
  });
}

export function getUserEmptyKind(users: AdminUser[], filteredUsers: AdminUser[]): UserEmptyKind {
  if (users.length === 0) return 'no-data';
  return filteredUsers.length === 0 ? 'no-match' : 'has-data';
}
