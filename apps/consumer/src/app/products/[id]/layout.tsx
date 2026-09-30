import type { Metadata } from 'next';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { buildProductShareMetadata } from '@/lib/share-metadata';

// 상품 화면(page.tsx)은 클라이언트 컴포넌트라 링크 미리보기 메타데이터를 여기서 서버에서 만든다.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const response = await fetch(`${getApiBaseUrl()}/products/${encodeURIComponent(id)}`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return {};
    const product = (await response.json()) as Record<string, unknown>;
    if (product.id !== id) return {};
    return buildProductShareMetadata(product) ?? {};
  } catch {
    // 미리보기 실패가 상품 화면 표시를 막지 않도록 사이트 기본값으로 둔다.
    return {};
  }
}

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
