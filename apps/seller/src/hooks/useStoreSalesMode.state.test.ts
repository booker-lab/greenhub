import { describe, expect, it } from 'vitest';
import { resolveStoreSalesModeState, toMenuSalesMode } from './useStoreSalesMode.state';

describe('resolveStoreSalesModeState', () => {
  it('결과가 없으면 조회 중으로 본다', () => {
    expect(resolveStoreSalesModeState(null, 'store-1')).toEqual({ status: 'loading' });
  });

  it('가게가 없으면 조회 중으로 본다', () => {
    expect(
      resolveStoreSalesModeState(
        { storeId: 'store-1', status: 'ready', salesMode: 'legacy' },
        null,
      ),
    ).toEqual({ status: 'loading' });
  });

  it('다른 가게의 이전 결과는 쓰지 않는다', () => {
    expect(
      resolveStoreSalesModeState(
        { storeId: 'store-1', status: 'ready', salesMode: 'round_direct' },
        'store-2',
      ),
    ).toEqual({ status: 'loading' });
    expect(resolveStoreSalesModeState({ storeId: 'store-1', status: 'error' }, 'store-2')).toEqual({
      status: 'loading',
    });
  });

  it('같은 가게의 성공 결과는 판매 방식과 함께 돌려준다', () => {
    expect(
      resolveStoreSalesModeState(
        { storeId: 'store-1', status: 'ready', salesMode: 'legacy' },
        'store-1',
      ),
    ).toEqual({ status: 'ready', salesMode: 'legacy' });
  });

  it('같은 가게의 실패 결과는 실패로 돌려준다(legacy로 바꾸지 않는다)', () => {
    expect(resolveStoreSalesModeState({ storeId: 'store-1', status: 'error' }, 'store-1')).toEqual({
      status: 'error',
    });
  });
});

describe('toMenuSalesMode', () => {
  it('조회 중이면 undefined', () => {
    expect(toMenuSalesMode({ status: 'loading' })).toBeUndefined();
  });

  it('조회 성공이면 그 판매 방식', () => {
    expect(toMenuSalesMode({ status: 'ready', salesMode: 'round_direct' })).toBe('round_direct');
    expect(toMenuSalesMode({ status: 'ready', salesMode: 'legacy' })).toBe('legacy');
  });

  it('조회 실패면 접근을 막지 않도록 legacy', () => {
    expect(toMenuSalesMode({ status: 'error' })).toBe('legacy');
  });
});
