import { resolveHomeStoreId } from '@/components/home-store-selection';
import { getApiBaseUrl } from '@/lib/api-base-url';

// 매장이 바뀌는 일은 드물고, 단서가 틀려도 미리 조회가 한 번 헛도는 것뿐이라 10분 캐시한다.
const HOME_HINT_REVALIDATE_SECONDS = 600;
// 단서는 브라우저가 상품 목록을 받기 전에 와야 쓸모가 있으므로 오래 기다리지 않는다.
const HOME_HINT_TIMEOUT_MS = 1500;

function readStoreIds(payload: unknown): Array<{ storeId: string }> | null {
  const list = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null && 'items' in payload
      ? payload.items
      : null;
  if (!Array.isArray(list)) return null;
  return list.map((product: unknown) => {
    const storeId =
      typeof product === 'object' && product !== null && 'storeId' in product
        ? product.storeId
        : null;
    return { storeId: typeof storeId === 'string' ? storeId : '' };
  });
}

/**
 * 홈 첫 화면이 판매 방식·회차를 상품 목록과 함께 조회하도록, 활성 상품이 한 매장 것뿐이면 그 storeId를 알려 준다.
 * 10분 캐시 값이라 화면 판정에는 쓰지 않고 미리 조회 단서로만 쓴다. 못 읽거나 매장이 여럿이면 null.
 */
export async function loadHomeStoreHint(): Promise<string | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/products?isActive=true`, {
      next: { revalidate: HOME_HINT_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(HOME_HINT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const products = readStoreIds(await response.json());
    return products ? resolveHomeStoreId(products) : null;
  } catch {
    return null;
  }
}
