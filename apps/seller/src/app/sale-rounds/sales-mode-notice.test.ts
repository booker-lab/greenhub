import { describe, expect, it } from 'vitest';
import { showsRoundSalesModeWarning } from './sales-mode-notice';

describe('showsRoundSalesModeWarning', () => {
  it('조회 중(undefined)에는 경고를 숨긴다', () => {
    expect(showsRoundSalesModeWarning(undefined)).toBe(false);
  });

  it('회차 판매(round_direct) 가게에는 경고를 숨긴다', () => {
    expect(showsRoundSalesModeWarning('round_direct')).toBe(false);
  });

  it('예전 방식(legacy, 조회 실패 포함) 가게에는 경고를 보인다', () => {
    expect(showsRoundSalesModeWarning('legacy')).toBe(true);
  });
});
