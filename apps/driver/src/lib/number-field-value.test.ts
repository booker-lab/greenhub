import { describe, expect, it } from 'vitest';
import { formatNumberFieldDisplay, readNumberFieldInput } from './number-field-value';

describe('숫자 칸 표시', () => {
  it('천 단위 쉼표와 단위를 붙여 보인다', () => {
    expect(formatNumberFieldDisplay(10000, { suffix: '원', thousandSeparator: true })).toBe(
      '10,000원',
    );
    expect(formatNumberFieldDisplay(1234567, { suffix: '원', thousandSeparator: true })).toBe(
      '1,234,567원',
    );
  });

  it('쉼표를 고르지 않으면 예전처럼 숫자 그대로 보인다', () => {
    expect(formatNumberFieldDisplay(10000, { suffix: '원' })).toBe('10000원');
    expect(formatNumberFieldDisplay(3)).toBe('3');
  });

  it('빈 값은 빈 칸이다', () => {
    expect(formatNumberFieldDisplay('', { suffix: '원', thousandSeparator: true })).toBe('');
  });
});

describe('숫자 칸 입력 해석', () => {
  it('숫자를 더 치면 숫자만 읽는다', () => {
    expect(readNumberFieldInput('10,000원', '10,0000원')).toBe(100000);
  });

  it('쉼표·단위를 붙여 넣어도 숫자로 읽는다', () => {
    expect(readNumberFieldInput('', '10,000원')).toBe(10000);
  });

  it('끝에서 지우기를 누르면(단위가 지워지면) 마지막 숫자를 지운다', () => {
    expect(readNumberFieldInput('10,000원', '10,000')).toBe(1000);
  });

  it('쉼표 바로 뒤에서 지우기를 누르면 쉼표 앞 숫자를 지운다', () => {
    expect(readNumberFieldInput('10,000원', '10000원')).toBe(1000);
  });

  it('숫자를 지우면 그 숫자만 빠진다', () => {
    expect(readNumberFieldInput('10,000원', '1,000원')).toBe(1000);
  });

  it('마지막 숫자까지 지우면 빈 칸이다', () => {
    expect(readNumberFieldInput('5원', '5')).toBe('');
    expect(readNumberFieldInput('5원', '원')).toBe('');
  });

  it('최솟값 아래로는 내려가지 않는다', () => {
    expect(readNumberFieldInput('', '3', 5)).toBe(5);
  });
});
