import { describe, expect, it } from 'vitest';
import { buildOrdersHref, buildOrdersRoundFilterUrl, readOrdersDeepLink } from './orders-deep-link';

describe('주문 목록 주소 파라미터', () => {
  it('탭·배송 보류만·회차를 읽는다', () => {
    expect(readOrdersDeepLink('?tab=ACTION_REQUIRED&held=1&round=round-1')).toEqual({
      tab: 'ACTION_REQUIRED',
      heldOnly: true,
      roundId: 'round-1',
    });
    expect(readOrdersDeepLink('?tab=WAITING')).toEqual({
      tab: 'WAITING',
      heldOnly: false,
      roundId: null,
    });
  });

  it('모르는 탭, 처리 필요가 아닌 탭의 held, 너무 긴 회차 id는 무시한다', () => {
    expect(readOrdersDeepLink('?tab=UNKNOWN&round=')).toEqual({
      tab: null,
      heldOnly: false,
      roundId: null,
    });
    expect(readOrdersDeepLink('?tab=WAITING&held=1').heldOnly).toBe(false);
    expect(readOrdersDeepLink(`?round=${'r'.repeat(129)}`).roundId).toBeNull();
    expect(readOrdersDeepLink('').tab).toBeNull();
  });

  it('만든 링크를 다시 읽으면 같은 값이 나온다', () => {
    const href = buildOrdersHref({ tab: 'ACTION_REQUIRED', heldOnly: true, roundId: 'r 1&x' });
    expect(href).toBe('/orders?tab=ACTION_REQUIRED&held=1&round=r+1%26x');
    expect(readOrdersDeepLink(href.slice('/orders'.length))).toEqual({
      tab: 'ACTION_REQUIRED',
      heldOnly: true,
      roundId: 'r 1&x',
    });
  });

  it('홈의 기존 링크 모양(탭만)은 그대로다', () => {
    expect(buildOrdersHref({ tab: 'ACTION_REQUIRED' })).toBe('/orders?tab=ACTION_REQUIRED');
    expect(buildOrdersHref({ tab: 'DONE', heldOnly: true })).toBe('/orders?tab=DONE');
  });

  it('회차를 고르면 주소에 round만 남기고, 풀면 경로만 남긴다', () => {
    expect(buildOrdersRoundFilterUrl('/orders', 'round-1')).toBe('/orders?round=round-1');
    expect(buildOrdersRoundFilterUrl('/orders', null)).toBe('/orders');
  });

  it('회차 선택으로 만든 주소를 다시 읽으면 같은 회차다(새로고침·공유 링크)', () => {
    const url = buildOrdersRoundFilterUrl('/orders', 'r 1&x');
    expect(url).toBe('/orders?round=r+1%26x');
    expect(readOrdersDeepLink(url.slice('/orders'.length))).toEqual({
      tab: null,
      heldOnly: false,
      roundId: 'r 1&x',
    });
  });
});
