import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  PRODUCT_IN_USE_INACTIVE_MESSAGE,
  PRODUCT_IN_USE_MESSAGE,
  resolveProductDeleteFailure,
} from './_deleteResult';

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
}));

describe('상품 삭제 실패 안내', () => {
  it('판매 중인 상품의 409는 판매 중지를 누르라고 안내한다', () => {
    expect(resolveProductDeleteFailure(new ApiError(409, '서버 문구'), true)).toEqual({
      message: PRODUCT_IN_USE_MESSAGE,
      inUse: true,
    });
    expect(PRODUCT_IN_USE_MESSAGE).toBe(
      '주문·회차에 쓰인 상품은 지울 수 없어요. 판매 중지를 눌러 주세요.',
    );
  });

  it('이미 판매 중지된 상품의 409는 손님에게 보이지 않는다고 안내한다', () => {
    expect(resolveProductDeleteFailure(new ApiError(409, '서버 문구'), false)).toEqual({
      message: PRODUCT_IN_USE_INACTIVE_MESSAGE,
      inUse: true,
    });
  });

  it('다른 API 오류는 서버 문구를 그대로 보이고 판매 중지로 유도하지 않는다', () => {
    expect(resolveProductDeleteFailure(new ApiError(403, '권한이 없습니다'), true)).toEqual({
      message: '권한이 없습니다',
      inUse: false,
    });
  });

  it('네트워크 오류 등은 기본 문구를 보인다', () => {
    expect(resolveProductDeleteFailure(new TypeError('Failed to fetch'), true)).toEqual({
      message: '상품 삭제에 실패했습니다',
      inUse: false,
    });
  });
});
