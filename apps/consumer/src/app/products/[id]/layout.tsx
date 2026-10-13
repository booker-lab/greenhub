import type { Metadata } from 'next';
import { buildProductShareMetadata } from '@/lib/share-metadata';
import { fetchCachedProduct } from './product-server';

// 상품 화면 본문은 클라이언트 컴포넌트라 링크 미리보기 메타데이터를 여기서 서버에서 만든다.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await fetchCachedProduct(id);
  // 미리보기 실패가 상품 화면 표시를 막지 않도록 사이트 기본값으로 둔다.
  if (!product) return {};
  return buildProductShareMetadata(product) ?? {};
}

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
