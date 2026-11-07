import { describe, expect, it } from 'vitest';
import { resolveRoundSalesModeNotice } from './sales-mode-notice';

describe('resolveRoundSalesModeNotice', () => {
  it('조회 중에는 안내를 숨긴다', () => {
    expect(resolveRoundSalesModeNotice({ status: 'loading' })).toBeNull();
  });

  it('회차 판매(round_direct) 가게에는 안내를 숨긴다', () => {
    expect(resolveRoundSalesModeNotice({ status: 'ready', salesMode: 'round_direct' })).toBeNull();
  });

  it('실제 예전 방식(legacy) 가게에는 단정 경고를 보인다', () => {
    expect(resolveRoundSalesModeNotice({ status: 'ready', salesMode: 'legacy' })).toBe(
      'not_round_direct',
    );
  });

  it('조회에 실패하면 경고 대신 확인하지 못했다는 안내를 보인다', () => {
    expect(resolveRoundSalesModeNotice({ status: 'error' })).toBe('unknown');
  });
});
