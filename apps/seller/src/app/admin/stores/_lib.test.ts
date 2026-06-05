import { describe, expect, it } from 'vitest';
import { formatRate, parseRate, sortStores } from './_lib';

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

  it('옵션으로 상한을 좁힐 수 있다', () => {
    expect(parseRate('0.5', { max: 0.3 })).toEqual({
      ok: false,
      errorCode: 'OUT_OF_RANGE',
    });
  });
});

describe('formatRate', () => {
  it('미설정 수수료율은 전역 기본값을 표시한다', () => {
    expect(formatRate(undefined, 0.05)).toBe('기본 5.0%');
  });
});

describe('sortStores', () => {
  it('수수료율 정렬에서 미설정 값은 전역 기본값을 사용한다', () => {
    const stores = [
      { id: 'a', name: 'A', status: 'active', ownerId: 'o', createdAt: null },
      { id: 'b', name: 'B', status: 'active', ownerId: 'o', commissionRate: 0.03, createdAt: null },
    ] as never;

    expect(sortStores(stores, { key: 'rate', direction: 'asc' }, 0.05).map((s) => s.id)).toEqual([
      'b',
      'a',
    ]);
  });
});
