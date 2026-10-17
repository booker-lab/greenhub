import { describe, expect, it } from 'vitest';
import {
  apiPathSegment,
  InvalidApiPathSegmentError,
  isSafeApiPathSegment,
  readRouteParam,
} from './api-path';

const API_BASE = 'https://api.example.test';

describe('isSafeApiPathSegment', () => {
  it.each([
    'abc123',
    'b1f2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    'round-direct-e2e-run_1-chromium-order',
    '2026-10-18',
    'a.b',
    '주문 1',
    'a%2Fb',
    'x'.repeat(128),
  ])('식별자 %j는 허용한다', (value) => {
    expect(isSafeApiPathSegment(value)).toBe(true);
  });

  it.each([
    '',
    ' a',
    'a ',
    '\ta',
    '.',
    '..',
    '../x',
    'a..b',
    'a/b',
    '/a',
    'a?b',
    'a#b',
    'a\\b',
    'a\u0000b',
    'a\nb',
    'a\u001fb',
    'a\u007fb',
    'x'.repeat(129),
  ])('%j는 거부한다', (value) => {
    expect(isSafeApiPathSegment(value)).toBe(false);
  });

  // 배열 인자는 it.each가 펼치므로 한 겹 더 감싼다.
  it.each([
    [null],
    [undefined],
    [1],
    [['a']],
    [{ id: 'a' }],
  ])('문자열이 아닌 %j는 거부한다', (value) => {
    expect(isSafeApiPathSegment(value)).toBe(false);
  });
});

describe('apiPathSegment', () => {
  it('식별자를 encodeURIComponent로 인코딩해 돌려준다', () => {
    expect(apiPathSegment('order-1')).toBe('order-1');
    expect(apiPathSegment('주문 1')).toBe(encodeURIComponent('주문 1'));
    // `%`도 인코딩되어 서버가 한 번 디코딩해도 구분자가 되지 않는다.
    expect(apiPathSegment('a%2Fb')).toBe('a%252Fb');
  });

  it.each([
    [''],
    ['..'],
    ['a/b'],
    ['a?b'],
    ['a#b'],
    ['a\\b'],
    ['a\u0000b'],
    [null],
    [['a']],
  ])('형식이 맞지 않는 %j는 요청 전에 InvalidApiPathSegmentError를 던진다', (value) => {
    expect(() => apiPathSegment(value)).toThrow(InvalidApiPathSegmentError);
  });

  it('오류 메시지는 화면에 그대로 보여 줄 수 있는 한국어다', () => {
    expect(() => apiPathSegment('a/b')).toThrow(
      '주소 형식이 올바르지 않아 요청을 보내지 않았습니다.',
    );
  });

  it.each([
    'order-1',
    '주문 1',
    'a%2Fb',
    '%2e%2e',
    '.%2E',
    'a;b',
    "a'b",
    'a:b',
  ])('허용된 값 %j는 URL 정규화 뒤에도 경로 한 조각에 머문다', (value) => {
    const url = new URL(
      `${API_BASE}/stores/${apiPathSegment('store-1')}/orders/${apiPathSegment(value)}/hub-confirm`,
    );
    const segments = url.pathname.split('/');
    expect(segments).toHaveLength(6);
    expect(segments.slice(0, 4)).toEqual(['', 'stores', 'store-1', 'orders']);
    expect(decodeURIComponent(segments[4])).toBe(value);
    expect(segments[5]).toBe('hub-confirm');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });
});

describe('readRouteParam', () => {
  it('Next가 넘기는 퍼센트 인코딩 값을 한 번 디코딩해 원래 식별자로 돌려준다', () => {
    expect(readRouteParam('order-1')).toBe('order-1');
    expect(readRouteParam('%ED%95%9C%EA%B8%80')).toBe('한글');
    expect(readRouteParam('a%20b')).toBe('a b');
  });

  it.each([
    'order-1',
    '%ED%95%9C%EA%B8%80',
    'a%20b',
    'a.b',
  ])('정상 값 %j는 다시 인코딩하면 처음 값과 같다(이중 인코딩 없음)', (value) => {
    const decoded = readRouteParam(value);
    expect(decoded).not.toBeNull();
    expect(apiPathSegment(decoded)).toBe(value);
  });

  it.each([
    '..%2Fx',
    'a%2Fb',
    'a%3Fb',
    'a%23b',
    'a%5Cb',
    '%2e%2e',
    'a%00b',
    '%20a',
    '%E0%A4%A',
    '',
  ])('디코딩 뒤 형식이 맞지 않거나 디코딩할 수 없는 %j는 null', (value) => {
    expect(readRouteParam(value)).toBeNull();
  });

  // 캐치올 경로의 배열 값도 식별자로 받지 않는다. 배열 인자는 한 겹 더 감싼다.
  it.each([[undefined], [null], [['a', 'b']], [1]])('문자열이 아닌 %j는 null', (value) => {
    expect(readRouteParam(value)).toBeNull();
  });

  it('한 번 디코딩한 값에 남은 `%`는 API 경로에서 다시 인코딩된다', () => {
    const decoded = readRouteParam('%252e%252e');
    expect(decoded).toBe('%2e%2e');
    expect(apiPathSegment(decoded)).toBe('%252e%252e');
  });
});
