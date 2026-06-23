import type { Product, Variety } from '@greenhub/shared';
import { Box, Container } from '@mantine/core';
import { notFound } from 'next/navigation';
import ProductTopBar from '@/components/ProductTopBar';
import ProductActions from './_components/ProductActions';
import ProductImages from './_components/ProductImages';
import ProductInfo from './_components/ProductInfo';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function fetchProduct(id: string): Promise<Product | null> {
  try {
    const res = await fetch(`${API_URL}/products/${id}`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchVariety(varietyId: string): Promise<Variety | null> {
  try {
    const res = await fetch(`${API_URL}/varieties/${varietyId}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

interface ProductDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ fromCategory?: string; fromStore?: string; storeName?: string }>;
}

export default async function ProductDetailPage({ params, searchParams }: ProductDetailPageProps) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const product = await fetchProduct(id);
  if (!product) notFound();

  const variety = product.varietyId ? await fetchVariety(product.varietyId) : null;
  const categoryBackHref = getSafeCategoryBackHref(query.fromCategory);
  const backHref = categoryBackHref
    ? categoryBackHref
    : query.fromStore
      ? `/stores/${encodeURIComponent(query.fromStore)}`
      : undefined;
  const backLabel = categoryBackHref ? '카테고리로' : query.fromStore ? '상점으로' : undefined;

  return (
    <Container size="sm" p={0}>
      <ProductTopBar backHref={backHref} backLabel={backLabel} />
      <Box style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}>
        <ProductImages images={product.images ?? []} name={product.name} />
        <ProductInfo product={product} variety={variety}>
          <ProductActions product={product} />
        </ProductInfo>
      </Box>
    </Container>
  );
}

function getSafeCategoryBackHref(value?: string) {
  if (!value) return undefined;
  if (!value.startsWith('/category')) return undefined;
  if (value.startsWith('//')) return undefined;
  return value;
}
