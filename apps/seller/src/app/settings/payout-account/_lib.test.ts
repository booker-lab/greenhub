import { describe, expect, it } from 'vitest';
import { describeSavedAccount, readMaskedPayoutAccount, toPayoutAccountBody } from './_lib';

const valid = { bankName: '국민은행', accountHolder: '김그린', accountNumber: '110-123-456789' };

describe('정산 계좌 입력 정리', () => {
  it('앞뒤 공백을 지운 값을 보낸다', () => {
    expect(
      toPayoutAccountBody({
        bankName: ' 국민은행 ',
        accountHolder: ' 김그린 ',
        accountNumber: ' 3333012345678 ',
      }),
    ).toEqual({ bankName: '국민은행', accountHolder: '김그린', accountNumber: '3333012345678' });
  });

  it.each([
    ['은행 이름 빈칸', { bankName: '' }, '은행 이름'],
    ['은행 이름 특수문자', { bankName: '국민<b>' }, '은행 이름'],
    ['예금주 빈칸', { accountHolder: '  ' }, '예금주'],
    ['예금주 31자', { accountHolder: '가'.repeat(31) }, '30자'],
    ['계좌번호 문자', { accountNumber: '110-abc-4567' }, '계좌번호'],
    ['계좌번호 7자리', { accountNumber: '1234567' }, '계좌번호'],
    ['계좌번호 하이픈 연속', { accountNumber: '110--1234567' }, '계좌번호'],
    ['계좌번호 21자리', { accountNumber: '1'.repeat(21) }, '계좌번호'],
  ])('%s은 저장하지 않고 안내한다', (_label, patch, expected) => {
    const result = toPayoutAccountBody({ ...valid, ...patch });
    expect(typeof result).toBe('string');
    expect(result).toContain(expected);
  });

  it('하이픈 있는 번호와 없는 번호 모두 받는다', () => {
    expect(toPayoutAccountBody(valid)).toEqual(valid);
    expect(toPayoutAccountBody({ ...valid, accountNumber: '12345678' })).toEqual({
      ...valid,
      accountNumber: '12345678',
    });
  });
});

describe('저장된 정산 계좌 읽기', () => {
  const account = {
    bankName: '국민은행',
    accountHolder: '김그린',
    accountNumberMasked: '***-***-**6789',
    accountNumberLast4: '6789',
  };

  it('가린 계좌만 읽어 한 줄로 보인다', () => {
    const saved = readMaskedPayoutAccount({ account: { ...account, updatedAt: '2026-10-21' } });
    expect(saved).toEqual(account);
    expect(saved && describeSavedAccount(saved)).toBe('국민은행 ***-***-**6789 (예금주 김그린)');
  });

  it('계좌가 없거나 형식이 다르면 null', () => {
    expect(readMaskedPayoutAccount({ account: null })).toBeNull();
    expect(readMaskedPayoutAccount({})).toBeNull();
    expect(readMaskedPayoutAccount({ account: { bankName: '국민은행' } })).toBeNull();
    expect(readMaskedPayoutAccount(null)).toBeNull();
  });
});
