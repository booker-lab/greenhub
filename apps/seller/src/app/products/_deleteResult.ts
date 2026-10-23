import { ApiError } from '@/lib/api';

export const PRODUCT_IN_USE_MESSAGE =
  '주문·회차에 쓰인 상품은 지울 수 없어요. 판매 중지를 눌러 주세요.';
export const PRODUCT_IN_USE_INACTIVE_MESSAGE =
  '주문·회차에 쓰인 상품은 지울 수 없어요. 이미 판매 중지된 상품이라 손님에게는 보이지 않아요.';

export type ProductDeleteFailure = {
  message: string;
  /** 주문·회차가 참조해 지울 수 없는 상품 — 판매 중이면 판매 중지 버튼으로 유도한다. */
  inUse: boolean;
};

// 서버는 주문·회차 상품이 참조하는 상품의 물리 삭제를 409로 막는다.
export function resolveProductDeleteFailure(
  error: unknown,
  isActive: boolean,
): ProductDeleteFailure {
  if (error instanceof ApiError && error.status === 409) {
    return {
      message: isActive ? PRODUCT_IN_USE_MESSAGE : PRODUCT_IN_USE_INACTIVE_MESSAGE,
      inUse: true,
    };
  }
  return {
    message: error instanceof ApiError ? error.message : '상품 삭제에 실패했습니다',
    inUse: false,
  };
}
