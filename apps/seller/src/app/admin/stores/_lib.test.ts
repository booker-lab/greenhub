import { describe, expect, it } from 'vitest';
import { parseRate } from './_lib';

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
