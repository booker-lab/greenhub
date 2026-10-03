import { describe, expect, it } from 'vitest';
import { filterOrdersBySearch, matchesOrderSearch, phoneSearchDigits } from './order-search';

const order = (id: string, buyerName?: string, orderNumber?: string) => ({
  id,
  buyerName,
  orderNumber,
});

describe('phoneSearchDigits', () => {
  it('숫자·하이픈·공백만 있고 숫자 4자리 이상이면 숫자만 돌려준다', () => {
    expect(phoneSearchDigits('5678')).toBe('5678');
    expect(phoneSearchDigits(' 010-1234-5678 ')).toBe('01012345678');
    expect(phoneSearchDigits('+82 10 1234 5678')).toBe('821012345678');
  });

  it('숫자가 4자리 미만이거나 글자가 섞이면 서버 전화 검색을 하지 않는다', () => {
    expect(phoneSearchDigits('')).toBeNull();
    expect(phoneSearchDigits('123')).toBeNull();
    expect(phoneSearchDigits('김1234')).toBeNull();
    expect(phoneSearchDigits('1'.repeat(21))).toBeNull();
  });
});

describe('matchesOrderSearch', () => {
  it('검색어가 비면 항상 통과한다', () => {
    expect(matchesOrderSearch(order('a'), '')).toBe(true);
    expect(matchesOrderSearch(order('a'), '   ')).toBe(true);
  });

  it('손님 이름 일부를 공백·대소문자 무시로 찾는다', () => {
    expect(matchesOrderSearch(order('a', '김 난초'), '김난')).toBe(true);
    expect(matchesOrderSearch(order('a', 'Orchid Kim'), 'kim')).toBe(true);
    expect(matchesOrderSearch(order('a', '김난초'), '박')).toBe(false);
    expect(matchesOrderSearch(order('a'), '김')).toBe(false);
  });

  it('주문번호 일부로 찾고, 주문번호가 없으면 카드에 보이는 id 끝 8자리로 찾는다', () => {
    expect(matchesOrderSearch(order('a', undefined, '20261004-000123'), '000123')).toBe(true);
    expect(matchesOrderSearch(order('order-abcdef12'), '#abcdef12')).toBe(true);
  });

  it('전화는 서버가 찾아 준 주문 id에 들어 있을 때만 맞다', () => {
    const ids = new Set(['b']);
    expect(matchesOrderSearch(order('b', '이손님', '20261004-000001'), '5678', ids)).toBe(true);
    expect(matchesOrderSearch(order('c', '박손님', '20261004-000002'), '5678', ids)).toBe(false);
    expect(matchesOrderSearch(order('b', '이손님', '20261004-000001'), '5678', null)).toBe(false);
  });
});

describe('filterOrdersBySearch', () => {
  it('검색어가 비면 같은 배열을 그대로 돌려주고, 있으면 순서를 유지해 거른다', () => {
    const list = [order('a', '김손님'), order('b', '이손님'), order('c', '김철수')];
    expect(filterOrdersBySearch(list, '')).toBe(list);
    expect(filterOrdersBySearch(list, '김').map((o) => o.id)).toEqual(['a', 'c']);
  });
});
