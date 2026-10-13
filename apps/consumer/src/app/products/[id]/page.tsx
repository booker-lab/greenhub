import ProductDetailClient from './ProductDetailClient';
import { loadProductHint } from './product-server';

interface ProductDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// 서버에서 상품의 매장·품종 ID를 미리 알려 주어, 브라우저가 상품·매장·품종을 차례로가 아니라 함께 읽게 한다.
export default async function ProductDetailPage({ params, searchParams }: ProductDetailPageProps) {
  const { id } = await params;
  const [query, hint] = await Promise.all([searchParams, loadProductHint(id)]);
  return <ProductDetailClient id={id} roundQuery={query.round} hint={hint} />;
}
