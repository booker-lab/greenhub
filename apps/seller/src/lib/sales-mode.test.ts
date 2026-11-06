import { describe, expect, it } from 'vitest';
import { showsGroupBuyChoice } from './sales-mode';

describe('showsGroupBuyChoice', () => {
  it('예전 판매 방식(legacy) 가게에는 보인다', () => {
    expect(showsGroupBuyChoice('legacy', 'normal')).toBe(true);
  });

  it('회차 판매 가게와 판매 방식을 아직 모를 때는 숨긴다', () => {
    expect(showsGroupBuyChoice('round_direct', 'normal')).toBe(false);
    expect(showsGroupBuyChoice(undefined, 'normal')).toBe(false);
  });

  it('이미 공동구매로 고른 값이 있으면 회차 판매 가게에서도 보여 되돌릴 수 있게 한다', () => {
    expect(showsGroupBuyChoice('round_direct', 'group')).toBe(true);
    expect(showsGroupBuyChoice(undefined, 'group')).toBe(true);
  });
});
