import { describe, expect, it } from 'vitest';
import { getAdminOrdersReadState } from './_lib';

const FETCH_ERROR_MESSAGE = '주문 목록 조회 중 오류 발생';

function order(id: string) {
  return { id };
}

describe('getAdminOrdersReadState', () => {
  it('조회 중에는 LOADING을 반환한다', () => {
    expect(getAdminOrdersReadState({ loading: true, error: null, orders: [] })).toBe('LOADING');
  });

  it('조회 실패 + 0건은 FETCH_ERROR를 반환한다(EMPTY collapse 방지)', () => {
    expect(
      getAdminOrdersReadState({ loading: false, error: FETCH_ERROR_MESSAGE, orders: [] }),
    ).toBe('FETCH_ERROR');
  });

  it('성공 + 0건만 EMPTY를 반환한다', () => {
    expect(getAdminOrdersReadState({ loading: false, error: null, orders: [] })).toBe('EMPTY');
  });

  it('성공 + 1건 이상은 HAS_RESULTS를 반환한다', () => {
    expect(
      getAdminOrdersReadState({ loading: false, error: null, orders: [order('o1')] }),
    ).toBe('HAS_RESULTS');
  });

  it('loading + error는 LOADING을 우선한다', () => {
    expect(
      getAdminOrdersReadState({ loading: true, error: FETCH_ERROR_MESSAGE, orders: [] }),
    ).toBe('LOADING');
  });

  it('error는 결과 유무보다 우선한다', () => {
    expect(
      getAdminOrdersReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        orders: [order('o1')],
      }),
    ).toBe('FETCH_ERROR');
  });
});
