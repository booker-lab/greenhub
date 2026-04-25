import { notFound } from 'next/navigation'
import { Container, Box } from '@mantine/core'
import ProductTopBar from '@/components/ProductTopBar'
import ProductImages from './_components/ProductImages'
import ProductInfo from './_components/ProductInfo'
import ProductActions from './_components/ProductActions'
import type { Product, Variety } from '@greenhub/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

async function fetchProduct(id: string): Promise<Product | null> {
  try {
    const res = await fetch(`${API_URL}/products/${id}`, { next: { revalidate: 30 } })
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

async function fetchVariety(varietyId: string): Promise<Variety | null> {
  try {
    const res = await fetch(`${API_URL}/varieties/${varietyId}`, { next: { revalidate: 3600 } })
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await fetchProduct(id)
  if (!product) notFound()

  const variety = product.varietyId ? await fetchVariety(product.varietyId) : null

  return (
    <Container size="sm" p={0}>
      <ProductTopBar />
      <Box style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}>
        <ProductImages images={product.images ?? []} name={product.name} />
        <ProductInfo product={product} variety={variety} />
        <ProductActions product={product} />
      </Box>
    </Container>
  )
}
