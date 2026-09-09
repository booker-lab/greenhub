import { describe, expect, it } from 'vitest';
import { filterByTab, getAdminDriversReadState } from './_lib';

const FETCH_ERROR_MESSAGE = '드라이버 목록 조회 중 오류 발생';

function driver(id: string) {
  return { id };
}

describe('getAdminDriversReadState', () => {
  it('조회 중에는 LOADING을 반환한다', () => {
    expect(getAdminDriversReadState({ loading: true, error: null, drivers: [] })).toBe('LOADING');
  });

  it('조회 실패 + 0건은 FETCH_ERROR를 반환한다(EMPTY collapse 방지)', () => {
    expect(
      getAdminDriversReadState({ loading: false, error: FETCH_ERROR_MESSAGE, drivers: [] }),
    ).toBe('FETCH_ERROR');
  });

  it('성공 + 0건만 EMPTY를 반환한다', () => {
    expect(getAdminDriversReadState({ loading: false, error: null, drivers: [] })).toBe('EMPTY');
  });

  it('성공 + 1건 이상은 HAS_RESULTS를 반환한다', () => {
    expect(
      getAdminDriversReadState({ loading: false, error: null, drivers: [driver('d1')] }),
    ).toBe('HAS_RESULTS');
  });

  it('loading + error는 LOADING을 우선한다', () => {
    expect(
      getAdminDriversReadState({ loading: true, error: FETCH_ERROR_MESSAGE, drivers: [] }),
    ).toBe('LOADING');
  });

  it('error는 결과 유무보다 우선한다', () => {
    expect(
      getAdminDriversReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        drivers: [driver('d1')],
      }),
    ).toBe('FETCH_ERROR');
  });
});

describe('filterByTab semantics (unchanged)', () => {
  const pending = {
    id: 'p1',
    name: '대기',
    email: 'p@example.com',
    driverApproved: false,
    suspended: false,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const approved = {
    id: 'a1',
    name: '승인',
    email: 'a@example.com',
    driverApproved: true,
    suspended: false,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const suspended = {
    id: 's1',
    name: '정지',
    email: 's@example.com',
    driverApproved: true,
    suspended: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const all = [pending, approved, suspended];

  it('pending 탭은 미승인+미정지만 반환한다', () => {
    expect(filterByTab(all, 'pending')).toEqual([pending]);
  });

  it('approved 탭은 승인+미정지만 반환한다', () => {
    expect(filterByTab(all, 'approved')).toEqual([approved]);
  });

  it('suspended 탭은 정지만 반환한다', () => {
    expect(filterByTab(all, 'suspended')).toEqual([suspended]);
  });

  it('all 탭은 전체를 반환한다', () => {
    expect(filterByTab(all, 'all')).toEqual(all);
  });
});
