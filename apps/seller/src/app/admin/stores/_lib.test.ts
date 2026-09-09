import { describe, expect, it } from 'vitest';
import { getAdminStoresReadState, parseRate } from './_lib';

describe('parseRate', () => {
  it('소수 수수료율을 정상 값으로 변환한다', () => {
    expect(parseRate('0.05')).toEqual({ ok: true, rate: 0.05 });
  });

  it('하한 0을 허용한다', () => {
    expect(parseRate('0')).toEqual({ ok: true, rate: 0 });
  });

  it('상한 1을 허용한다', () => {
    expect(parseRate('1')).toEqual({ ok: true, rate: 1 });
  });

  it('빈 입력은 EMPTY 오류로 반환한다', () => {
    expect(parseRate('')).toEqual({ ok: false, errorCode: 'EMPTY' });
  });

  it('공백만 있는 입력은 EMPTY 오류로 반환한다', () => {
    expect(parseRate('  ')).toEqual({ ok: false, errorCode: 'EMPTY' });
  });

  it('숫자로 해석되지 않는 입력은 NOT_NUMBER 오류로 반환한다', () => {
    expect(parseRate('abc')).toEqual({ ok: false, errorCode: 'NOT_NUMBER' });
  });

  it('하한보다 작은 값은 OUT_OF_RANGE 오류로 반환한다', () => {
    expect(parseRate('-0.1')).toEqual({ ok: false, errorCode: 'OUT_OF_RANGE' });
  });

  it('상한보다 큰 값은 OUT_OF_RANGE 오류로 반환한다', () => {
    expect(parseRate('1.5')).toEqual({ ok: false, errorCode: 'OUT_OF_RANGE' });
  });

  it('앞뒤 공백을 제거한 값으로 변환한다', () => {
    expect(parseRate(' 0.5 ')).toEqual({ ok: true, rate: 0.5 });
  });
});

const FETCH_ERROR_MESSAGE = '판매자 목록 조회 중 오류 발생';

function store(id: string) {
  return { id };
}

describe('getAdminStoresReadState', () => {
  it('조회 중에는 LOADING을 반환한다', () => {
    expect(
      getAdminStoresReadState({ loading: true, error: null, stores: [], visible: [] }),
    ).toBe('LOADING');
  });

  it('loading + error는 LOADING을 우선한다(재시도 중 error 잔존)', () => {
    expect(
      getAdminStoresReadState({
        loading: true,
        error: FETCH_ERROR_MESSAGE,
        stores: [],
        visible: [],
      }),
    ).toBe('LOADING');
  });

  it('initial read failure → FETCH_ERROR를 반환한다', () => {
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [],
        visible: [],
      }),
    ).toBe('FETCH_ERROR');
  });

  it('read failure ≠ unfiltered empty', () => {
    // 실패 + 0건은 FETCH_ERROR이며 실제 0건 copy로 collapse되지 않는다.
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [],
        visible: [],
      }),
    ).toBe('FETCH_ERROR');
    // 성공 + 0건만 실제 0건이다.
    expect(
      getAdminStoresReadState({ loading: false, error: null, stores: [], visible: [] }),
    ).toBe('EMPTY_UNFILTERED');
  });

  it('read failure ≠ filtered empty', () => {
    // 실패 + 필터 결과 0건(stale stores 유지)도 FETCH_ERROR이다.
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [store('s1')],
        visible: [],
      }),
    ).toBe('FETCH_ERROR');
    // 성공 + 동일 shape만 필터 결과 0건이다.
    expect(
      getAdminStoresReadState({
        loading: false,
        error: null,
        stores: [store('s1')],
        visible: [],
      }),
    ).toBe('EMPTY_FILTERED');
  });

  it('error는 stale 결과보다 우선한다(useAdminList 이전 결과 보존 기준)', () => {
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [store('s1')],
        visible: [store('s1')],
      }),
    ).toBe('FETCH_ERROR');
  });

  it('성공 + 결과는 HAS_RESULTS를 반환한다', () => {
    expect(
      getAdminStoresReadState({
        loading: false,
        error: null,
        stores: [store('s1')],
        visible: [store('s1')],
      }),
    ).toBe('HAS_RESULTS');
  });
});
