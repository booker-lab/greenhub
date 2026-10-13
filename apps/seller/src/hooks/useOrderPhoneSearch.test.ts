import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  buildLegacyOrderPhoneSearchPath,
  buildOrderPhoneSearchRequest,
  requestOrderPhoneSearch,
} from './useOrderPhoneSearch';

// vi.mock은 import보다 먼저 적용된다.
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
// vitest에는 '@/' 별칭 설정이 없어 lib/api를 같은 모양(status를 가진 ApiError)으로 대신한다.
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
  apiJson: vi.fn(),
}));

describe('판매자 주문 전화 검색 요청', () => {
  it('전화번호를 URL이 아니라 POST 본문으로 보낸다', () => {
    const { path, init } = buildOrderPhoneSearchRequest('store-1', '01012345678');

    expect(path).toBe('/stores/store-1/orders/phone-search');
    expect(path).not.toContain('01012345678');
    expect(path).not.toContain('?');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ phone: '01012345678' });
  });

  it('매장 id는 경로 조각으로 인코딩한다', () => {
    const { path } = buildOrderPhoneSearchRequest('store id/한글', '5678');
    expect(path).toBe(`/stores/${encodeURIComponent('store id/한글')}/orders/phone-search`);
  });

  it('API가 POST 경로를 지원하면 GET은 부르지 않는다', async () => {
    const request = vi.fn().mockResolvedValue([{ id: 'order-1' }]);

    await expect(requestOrderPhoneSearch('store-1', '5678', request)).resolves.toEqual([
      { id: 'order-1' },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/stores/store-1/orders/phone-search', {
      method: 'POST',
      body: JSON.stringify({ phone: '5678' }),
    });
  });

  it('POST 경로가 없는 이전 API 배포(404)면 deprecated GET으로 한 번만 대체한다', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'Cannot POST /stores/store-1/orders/phone-search'))
      .mockResolvedValueOnce([{ id: 'order-2' }]);

    await expect(requestOrderPhoneSearch('store-1', '5678', request)).resolves.toEqual([
      { id: 'order-2' },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(buildLegacyOrderPhoneSearchPath('store-1', '5678'));
    expect(buildLegacyOrderPhoneSearchPath('store-1', '5678')).toBe(
      '/stores/store-1/orders?phone=5678',
    );
  });

  it.each([
    ['검증 오류', new ApiError(400, '전화번호 검색은 숫자 4자리 이상이어야 합니다.')],
    ['권한 오류', new ApiError(403, '해당 스토어 주문을 조회할 권한이 없습니다.')],
    ['서버 오류', new ApiError(500, '서버 오류 (500)')],
    ['네트워크 오류', new TypeError('Failed to fetch')],
  ])('%s는 GET으로 대체하지 않고 그대로 던진다', async (_label, error) => {
    const request = vi.fn().mockRejectedValue(error);

    await expect(requestOrderPhoneSearch('store-1', '5678', request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('훅은 전화번호를 쿼리에 붙이는 경로를 직접 만들지 않는다', () => {
    const source = readFileSync(new URL('./useOrderPhoneSearch.ts', import.meta.url), 'utf8');
    const hookBody = source.slice(source.indexOf('export function useOrderPhoneSearch'));

    expect(hookBody).toContain('requestOrderPhoneSearch(');
    expect(hookBody).not.toContain('?phone=');
  });
});
