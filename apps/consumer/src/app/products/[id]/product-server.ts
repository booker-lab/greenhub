import { cache } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { type StructuredRound, selectOrderableRound } from '@/lib/structured-data';

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

// 구조화 데이터의 가격·판매 상태용. 회차 상태는 시각에 따라 바뀌므로 상품보다 짧게 캐시한다.
const ROUND_REVALIDATE_SECONDS = 60;

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      next: { revalidate: ROUND_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null;
  }
}

function readItems(payload: unknown): unknown[] | null {
  if (typeof payload !== 'object' || payload === null || !('items' in payload)) return null;
  return Array.isArray(payload.items) ? payload.items : null;
}

/** 지금 주문할 수 있거나 곧 주문을 받는 공개 회차(품목 포함). 없거나 읽지 못하면 null. */
export async function loadOrderableRound(
  storeId: string,
  now: Date = new Date(),
): Promise<StructuredRound | null> {
  const listUrl = `${getApiBaseUrl()}/stores/${encodeURIComponent(storeId)}/sale-rounds/public`;
  const summaries = readItems(await fetchJson(listUrl)) as StructuredRound[] | null;
  if (!summaries) return null;
  const target = selectOrderableRound(summaries, now);
  if (!target) return null;
  const detail = await fetchJson(`${listUrl}/${encodeURIComponent(target.id)}`);
  const items = readItems(detail);
  if (!items || (detail as StructuredRound).id !== target.id) return null;
  return detail as StructuredRound;
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function loadProductHint(id: string): Promise<ProductLoadHint | null> {
  const product = await fetchCachedProduct(id);
  if (!product) return null;
  return { id, storeId: optionalId(product.storeId), varietyId: optionalId(product.varietyId) };
}
