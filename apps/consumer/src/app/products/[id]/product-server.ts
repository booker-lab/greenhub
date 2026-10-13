import { cache } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

export interface ProductLoadHint {
  id: string;
  storeId: string | null;
  varietyId: string | null;
}

// 링크 미리보기 메타데이터(layout)와 화면(page)이 같은 요청 안에서 상품을 한 번만 읽는다.
// 10분 캐시 값이라 화면 표시에는 쓰지 않고, 매장·품종 조회를 미리 시작하는 단서로만 쓴다.
export const fetchCachedProduct = cache(
  async (id: string): Promise<Record<string, unknown> | null> => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/products/${encodeURIComponent(id)}`, {
        next: { revalidate: 600 },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return null;
      const product = (await response.json()) as Record<string, unknown>;
      return product.id === id ? product : null;
    } catch {
      return null;
    }
  },
);

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function loadProductHint(id: string): Promise<ProductLoadHint | null> {
  const product = await fetchCachedProduct(id);
  if (!product) return null;
  return { id, storeId: optionalId(product.storeId), varietyId: optionalId(product.varietyId) };
}
