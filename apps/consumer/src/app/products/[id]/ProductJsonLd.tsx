import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import { SITE_URL } from '@/lib/share-metadata';
import { buildProductJsonLd, serializeJsonLd } from '@/lib/structured-data';
import { fetchCachedProduct, loadOrderableRound } from './product-server';

// 상품 구조화 데이터. 화면 본문과 따로 스트리밍해 첫 화면 응답을 회차 조회로 늦추지 않는다.
export default async function ProductJsonLd({ id }: { id: string }) {
  const product = await fetchCachedProduct(id);
  if (!product || typeof product.storeId !== 'string') return null;
  const round = await loadOrderableRound(product.storeId);
  const jsonLd = buildProductJsonLd({
    product,
    round,
    siteUrl: SITE_URL,
    sellerName: PUBLIC_BUSINESS_INFO.businessName,
  });
  if (!jsonLd) return null;
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: serializeJsonLd가 `<`를 이스케이프해 태그를 닫을 수 없다
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
    />
  );
}
