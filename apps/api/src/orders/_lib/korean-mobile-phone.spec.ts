import { normalizeKoreanMobilePhone } from './korean-mobile-phone';

describe('normalizeKoreanMobilePhone', () => {
  it.each([
    ['010-1234-5678', '010-1234-5678'],
    ['01012345678', '010-1234-5678'],
    [' 010 1234 5678 ', '010-1234-5678'],
    ['(010)1234-5678', '010-1234-5678'],
    ['+82 10-1234-5678', '010-1234-5678'],
    ['011-123-4567', '011-123-4567'],
    ['01000000000', '010-0000-0000'],
  ])('휴대폰 번호 %s는 %s로 맞춰 받는다', (input, expected) => {
    expect(normalizeKoreanMobilePhone(input)).toBe(expected);
  });

  it.each([
    ['00000000'],
    ['1234-5678'],
    ['010-123-567'],
    ['02-123-4567'],
    ['031-123-4567'],
    ['        '],
    ['010-1234-56789'],
    [''],
  ])('휴대폰이 아니거나 자릿수가 맞지 않는 %p는 거절한다', (input) => {
    expect(normalizeKoreanMobilePhone(input)).toBeNull();
  });

  it('문자열이 아니면 거절한다', () => {
    expect(normalizeKoreanMobilePhone(undefined)).toBeNull();
    expect(normalizeKoreanMobilePhone(1012345678)).toBeNull();
  });
});
