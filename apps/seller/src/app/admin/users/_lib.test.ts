import { describe, expect, it } from 'vitest';
import type { AdminUser } from '@/hooks/useAdmin';
import { filterUsers, getUserEmptyKind } from './_lib';

const users: AdminUser[] = [
  {
    id: 'u1',
    email: 'minsu@example.com',
    name: '김민수',
    phone: '010-1234-5678',
    suspended: false,
    createdAt: null,
  },
  {
    id: 'u2',
    email: 'sora@example.com',
    name: '이소라',
    phone: '01099998888',
    suspended: true,
    createdAt: null,
  },
  {
    id: 'u3',
    email: 'no-phone@example.com',
    name: '전화없음',
    createdAt: null,
  },
];

describe('filterUsers', () => {
  it('공백 검색어는 상태 조건만 적용한다', () => {
    expect(filterUsers(users, { keyword: '   ', status: 'all' })).toHaveLength(3);
  });

  it('이름과 이메일은 대소문자 구분 없이 부분 일치한다', () => {
    expect(filterUsers(users, { keyword: 'MIN', status: 'all' }).map((user) => user.id)).toEqual([
      'u1',
    ]);
    expect(filterUsers(users, { keyword: '소라', status: 'all' }).map((user) => user.id)).toEqual([
      'u2',
    ]);
  });

  it('전화번호는 하이픈 입력 여부와 무관하게 일치한다', () => {
    expect(
      filterUsers(users, { keyword: '010-1234-5678', status: 'all' }).map((user) => user.id),
    ).toEqual(['u1']);
    expect(filterUsers(users, { keyword: '9999', status: 'all' }).map((user) => user.id)).toEqual([
      'u2',
    ]);
  });

  it('정상 상태는 suspended가 true가 아닌 사용자를 반환한다', () => {
    expect(filterUsers(users, { keyword: '', status: 'active' }).map((user) => user.id)).toEqual([
      'u1',
      'u3',
    ]);
  });

  it('정지 상태는 suspended가 true인 사용자만 반환한다', () => {
    expect(filterUsers(users, { keyword: '', status: 'suspended' }).map((user) => user.id)).toEqual(
      ['u2'],
    );
  });
});

describe('getUserEmptyKind', () => {
  it('원본 데이터가 비어 있으면 no-data를 반환한다', () => {
    expect(getUserEmptyKind([], [])).toBe('no-data');
  });

  it('필터 결과만 비어 있으면 no-match를 반환한다', () => {
    expect(getUserEmptyKind(users, [])).toBe('no-match');
  });

  it('필터 결과가 있으면 has-data를 반환한다', () => {
    expect(getUserEmptyKind(users, users.slice(0, 1))).toBe('has-data');
  });
});
