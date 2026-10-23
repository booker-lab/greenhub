import type { SaleRoundItem, SaleRoundStatus } from '@greenhub/shared';
import type { CartAddFailureReason, RoundCartItem } from '@/hooks/useCart';

// 홈 상품 카드의 "+ 바로 담기"와 상품 상세 담기가 같은 규칙·문구를 쓰게 모은 순수 함수.

/** 주문 받는 중인 현재 회차의 판매 중 상품만 바로 담을 수 있다. */
export function canQuickAdd(
  item: Pick<SaleRoundItem, 'status'>,
  roundStatus: SaleRoundStatus,
  isPast: boolean,
): boolean {
  return !isPast && roundStatus === 'OPEN' && item.status === 'ACTIVE';
}

/** 회차 상품 1개를 장바구니 항목으로 만든다. 가격은 회차 가격을 쓴다. */
export function roundItemCartInput(
  item: Pick<
    SaleRoundItem,
    | 'id'
    | 'roundId'
    | 'storeId'
    | 'productId'
    | 'productNameSnapshot'
    | 'productImageUrlSnapshot'
    | 'roundPrice'
  >,
  quantity = 1,
): RoundCartItem {
  return {
    productId: item.productId,
    name: item.productNameSnapshot,
    price: item.roundPrice,
    image: item.productImageUrlSnapshot ?? '',
    quantity,
    saleType: 'normal',
    deliveryMethod: 'direct',
    storeId: item.storeId,
    roundId: item.roundId,
    roundItemId: item.id,
    roundPrice: item.roundPrice,
  };
}

export function cartAddFailureMessage(reason: CartAddFailureReason): string {
  if (reason === 'different_round') {
    return '장바구니에는 같은 회차 상품만 담을 수 있습니다. 기존 장바구니를 비운 뒤 다시 시도해 주세요.';
  }
  if (reason === 'incompatible_cart') {
    return '기존 판매 상품과 회차 상품은 함께 담을 수 없습니다. 기존 장바구니를 비운 뒤 다시 시도해 주세요.';
  }
  return '회차 상품 정보를 확인할 수 없어 장바구니에 담지 못했습니다.';
}

/** 회차 상품의 상품 화면 주소. 옵션을 골라야 하는 상품은 바로 담지 않고 이 화면으로 보낸다. */
export function roundProductHref(item: Pick<SaleRoundItem, 'productId' | 'roundId'>): string {
  return `/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(item.roundId)}`;
}

/**
 * 공개 상품 응답에 골라야 하는 옵션 묶음(화분 등)이 있는지. 서버는 옵션 묶음이 있는 상품을 옵션 없이
 * 주문하면 거부하므로(2026-10-24), 이런 상품은 바로 담지 않고 상품 화면의 옵션 시트로 보낸다.
 */
export function productNeedsOptionChoice(product: unknown): boolean {
  if (typeof product !== 'object' || product === null) return false;
  const options = (product as { options?: unknown }).options;
  return Array.isArray(options) && options.length > 0;
}
