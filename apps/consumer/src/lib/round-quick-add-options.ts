import { getApiBaseUrl } from '@/lib/api-base-url';
import { productNeedsOptionChoice } from '@/lib/round-quick-add';

const API_URL = getApiBaseUrl();

/**
 * 바로 담기(홈·찜·장바구니 추천·다시 주문) 전에 그 상품이 옵션을 골라야 하는지 공개 상품 조회로 확인한다.
 * 조회에 실패하면 고르는 쪽으로 본다. 상품 화면이 다시 판단하고, 옵션 없이 담긴 상품은 결제 전에 서버가 거부한다.
 */
export async function fetchNeedsOptionChoice(productId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/products/${encodeURIComponent(productId)}`);
    if (!res.ok) return true;
    return productNeedsOptionChoice(await res.json());
  } catch {
    return true;
  }
}
