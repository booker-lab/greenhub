import type { MetadataRoute } from 'next';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { SITE_URL } from '@/lib/share-metadata';

// 상품이 바뀌어도 하루 안에 목록에 반영되도록 1시간마다 다시 만든다.
export const revalidate = 3600;

const STATIC_PATHS = ['/', '/category', '/terms', '/privacy'];

interface SitemapProduct {
  id?: unknown;
  updatedAt?: unknown;
}

async function fetchActiveProducts(): Promise<SitemapProduct[]> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/products?isActive=true`, {
      next: { revalidate },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as unknown;
    const list = Array.isArray(data) ? data : (data as { items?: unknown } | null)?.items;
    return Array.isArray(list) ? (list as SitemapProduct[]) : [];
  } catch {
    // 상품 목록을 못 읽어도 고정 화면 주소는 알린다.
    return [];
  }
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await fetchActiveProducts();
  const productEntries = products.flatMap((product) =>
    typeof product.id === 'string' && product.id
      ? [
          {
            url: `${SITE_URL}/products/${encodeURIComponent(product.id)}`,
            lastModified: validDate(product.updatedAt),
          },
        ]
      : [],
  );
  return [...STATIC_PATHS.map((path) => ({ url: `${SITE_URL}${path}` })), ...productEntries];
}
