import type { Metadata } from 'next';
import BusinessInfoFooter from '@/components/BusinessInfoFooter';
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
  const metadata = buildProductShareMetadata(product);
  if (!metadata) return {};
  // 회차(?round=)마다 주소가 달라져도 검색엔진에는 상품 주소 하나로 알린다.
  return { ...metadata, alternates: { canonical: `/products/${encodeURIComponent(id)}` } };
}

// PG·카드사 입점 심사는 사업자 정보가 홈뿐 아니라 상품·결제 화면에도 늘 보이길 요구한다.
// 하단에 고정된 구매 바(ProductCTABar)가 footer 끝을 가리지 않게 아래를 그 높이만큼 띄운다.
export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Mantine Container size="sm" px="md": 최대 720px, 좌우 16px, 가운데 정렬 */}
      <div
        className="mx-auto max-w-[720px] px-4"
        style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}
      >
        <BusinessInfoFooter />
      </div>
    </>
  );
}
