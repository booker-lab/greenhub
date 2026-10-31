import { Suspense } from 'react';
import ProductDetailClient from './ProductDetailClient';
import ProductJsonLd from './ProductJsonLd';
import { loadProductHint } from './product-server';

interface ProductDetailPageProps {
  params: Promise<{ id: string }>;
}

// 상품 화면은 처음 열릴 때 만들어 CDN에 두고, 상품·회차 조회의 재검증 주기(product-server.ts)에 따라
// 다시 만든다(ISR). 빌드 때 미리 만드는 상품은 없다. 회차 쿼리(?round=)는 브라우저에서 읽는다.
export async function generateStaticParams(): Promise<Array<{ id: string }>> {
  return [];
}

// 서버에서 상품의 매장·품종 ID를 미리 알려 주어, 브라우저가 상품·매장·품종을 차례로가 아니라 함께 읽게 한다.
export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { id } = await params;
  const hint = await loadProductHint(id);
  return (
    <>
      <ProductDetailClient id={id} hint={hint} />
      <Suspense fallback={null}>
        <ProductJsonLd id={id} />
      </Suspense>
    </>
  );
}
