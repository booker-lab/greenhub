import { describe, expect, it } from 'vitest';
import { getAdminInviteReadState } from './_lib';

const FETCH_ERROR_MESSAGE = '초대 토큰 조회 중 오류 발생';

function invite(id: string) {
  return { id };
}

describe('getAdminInviteReadState', () => {
  it('조회 중에는 LOADING을 반환한다', () => {
    expect(getAdminInviteReadState({ loading: true, error: null, invites: [] })).toBe('LOADING');
  });

  it('조회 실패 + 0건은 FETCH_ERROR를 반환한다(EMPTY collapse 방지)', () => {
    expect(
      getAdminInviteReadState({ loading: false, error: FETCH_ERROR_MESSAGE, invites: [] }),
    ).toBe('FETCH_ERROR');
  });

  it('성공 + 0건만 EMPTY를 반환한다', () => {
    expect(getAdminInviteReadState({ loading: false, error: null, invites: [] })).toBe('EMPTY');
  });

  it('성공 + 1건 이상은 HAS_RESULTS를 반환한다', () => {
    expect(
      getAdminInviteReadState({ loading: false, error: null, invites: [invite('i1')] }),
    ).toBe('HAS_RESULTS');
  });

  it('loading + error는 LOADING이 우선한다', () => {
    expect(
      getAdminInviteReadState({ loading: true, error: FETCH_ERROR_MESSAGE, invites: [] }),
    ).toBe('LOADING');
  });

  it('error는 결과 유무보다 우선한다', () => {
    expect(
      getAdminInviteReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        invites: [invite('i1')],
      }),
    ).toBe('FETCH_ERROR');
  });
});
