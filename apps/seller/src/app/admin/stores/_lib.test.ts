import { describe, expect, it } from 'vitest';
import {
  describeCommissionSaved,
  formatRate,
  getAdminStoresReadState,
  parseRate,
  rateToInput,
} from './_lib';

describe('parseRate (% 단위 입력 → 0~1 저장값)', () => {
  it('% 숫자를 0~1 수수료율로 바꾼다(5 → 0.05)', () => {
    expect(parseRate('5')).toEqual({ ok: true, rate: 0.05 });
    expect(parseRate('7.5')).toEqual({ ok: true, rate: 0.075 });
    expect(parseRate('12.34')).toEqual({ ok: true, rate: 0.1234 });
  });

  it('하한 0%와 상한 100%를 허용한다', () => {
    expect(parseRate('0')).toEqual({ ok: true, rate: 0 });
    expect(parseRate('100')).toEqual({ ok: true, rate: 1 });
  });

  it('끝의 % 기호와 앞뒤 공백을 무시한다', () => {
    expect(parseRate(' 5% ')).toEqual({ ok: true, rate: 0.05 });
    expect(parseRate(' 3 ')).toEqual({ ok: true, rate: 0.03 });
  });

  it('소수 셋째 자리 이하는 둘째 자리로 반올림해 부동소수 오차를 남기지 않는다', () => {
    expect(parseRate('5.555')).toEqual({ ok: true, rate: 0.0556 });
    expect(parseRate('0.1')).toEqual({ ok: true, rate: 0.001 });
  });

  it('빈 입력·공백만 있는 입력은 EMPTY', () => {
    expect(parseRate('')).toEqual({ ok: false, errorCode: 'EMPTY' });
    expect(parseRate('  ')).toEqual({ ok: false, errorCode: 'EMPTY' });
    expect(parseRate('%')).toEqual({ ok: false, errorCode: 'EMPTY' });
  });

  it('숫자가 아니면 NOT_NUMBER(뒤에 글자가 붙은 값도 거절)', () => {
    expect(parseRate('abc')).toEqual({ ok: false, errorCode: 'NOT_NUMBER' });
    expect(parseRate('5abc')).toEqual({ ok: false, errorCode: 'NOT_NUMBER' });
  });

  it('0% 미만·100% 초과는 OUT_OF_RANGE', () => {
    expect(parseRate('-0.1')).toEqual({ ok: false, errorCode: 'OUT_OF_RANGE' });
    expect(parseRate('100.5')).toEqual({ ok: false, errorCode: 'OUT_OF_RANGE' });
  });
});

describe('수수료율 표시', () => {
  it('저장값을 % 숫자로 보이고 미설정은 기본 5%로 보인다', () => {
    expect(formatRate(0.05)).toBe('5%');
    expect(formatRate(0.075)).toBe('7.5%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(undefined)).toBe('기본 5%');
  });

  it('편집칸 초기값은 % 숫자, 미설정이면 빈칸이다', () => {
    expect(rateToInput(0.05)).toBe('5');
    expect(rateToInput(0.1234)).toBe('12.34');
    expect(rateToInput(undefined)).toBe('');
  });

  it('입력 → 저장 → 다시 편집이 같은 값으로 돌아온다', () => {
    for (const input of ['0', '3', '5', '7.5', '12.34', '100']) {
      const parsed = parseRate(input);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(rateToInput(parsed.rate)).toBe(input);
    }
  });

  it('저장 안내는 다음 정산부터 적용·이미 만든 정산 불변을 알린다', () => {
    const message = describeCommissionSaved('난플렉스', 0.08);
    expect(message).toContain('난플렉스 수수료율 8%');
    expect(message).toContain('다음에 만들어지는 정산부터');
    expect(message).toContain('이미 만든 정산은 그대로');
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
