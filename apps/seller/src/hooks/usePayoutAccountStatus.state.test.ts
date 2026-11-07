import { describe, expect, it } from 'vitest';
import {
  readPayoutAccountRegistration,
  resolvePayoutAccountStatus,
} from './usePayoutAccountStatus.state';

const ACCOUNT = {
  bankName: '국민은행',
  accountHolder: '홍길동',
  accountNumberMasked: '****-****-1234',
  accountNumberLast4: '1234',
};

describe('정산 계좌 응답 → 등록 여부', () => {
  it('저장된 계좌가 있으면 등록', () => {
    expect(readPayoutAccountRegistration({ account: ACCOUNT })).toBe('registered');
  });

  it('account가 null이면 미등록', () => {
    expect(readPayoutAccountRegistration({ account: null })).toBe('missing');
  });

  it('모양이 다른 응답은 미등록으로 단정하지 않는다', () => {
    expect(readPayoutAccountRegistration({})).toBe('error');
    expect(readPayoutAccountRegistration(null)).toBe('error');
    expect(readPayoutAccountRegistration({ account: { bankName: '국민은행' } })).toBe('error');
  });
});

describe('정산 계좌 조회 상태', () => {
  it('결과가 없거나 가게가 없으면 조회 중', () => {
    expect(resolvePayoutAccountStatus(null, 'store-1')).toBe('loading');
    expect(resolvePayoutAccountStatus({ storeId: 'store-1', status: 'missing' }, null)).toBe(
      'loading',
    );
  });

  it('다른 가게의 이전 결과는 쓰지 않는다', () => {
    expect(
      resolvePayoutAccountStatus({ storeId: 'store-1', status: 'registered' }, 'store-2'),
    ).toBe('loading');
  });

  it('같은 가게 결과는 그대로 돌려준다', () => {
    expect(resolvePayoutAccountStatus({ storeId: 'store-1', status: 'error' }, 'store-1')).toBe(
      'error',
    );
    expect(resolvePayoutAccountStatus({ storeId: 'store-1', status: 'missing' }, 'store-1')).toBe(
      'missing',
    );
  });
});
