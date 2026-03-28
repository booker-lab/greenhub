'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import ProductForm from '../../_components/ProductForm'
import type { ProductFormData } from '../../_components/ProductForm'

// Firestore Timestamp | ISO string → YYYY-MM-DD
function toDateStr(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  // Firestore Timestamp shape
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    return new Date((value as { seconds: number }).seconds * 1000)
      .toISOString()
      .slice(0, 10)
  }
  return ''
}

export default function EditProductPage() {
  const params = useParams()
  const router = useRouter()
  const productId = params.id as string
  const { data: session } = useSession()
  const storeId = session?.user.storeId ?? ''
  const token = session?.user.accessToken ?? ''

  const [initialData, setInitialData] = useState<Partial<ProductFormData> | undefined>()
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!storeId || !token || !productId) return

    fetch(`${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) { setNotFound(true); return }
        const data = await res.json()
        const mapped: Partial<ProductFormData> = {
          name: data.name ?? '',
          category: data.category ?? 'cut_flower',
          colors: data.colors ?? [],
          deliverySize: data.deliverySize ?? 'small',
          price: String(data.price ?? ''),
          description: data.description ?? '',
          saleType: data.saleType ?? 'normal',
          images: data.images ?? [],
        }
        if (data.groupConfig) {
          mapped.groupConfig = {
            minParticipants: String(data.groupConfig.minParticipants ?? ''),
            maxParticipants: String(data.groupConfig.maxParticipants ?? ''),
            recruitDeadline: toDateStr(data.groupConfig.recruitDeadline),
            groupDeliveryDate: toDateStr(data.groupConfig.groupDeliveryDate),
            groupDeliveryMethod: data.groupConfig.groupDeliveryMethod ?? 'direct',
          }
        }
        setInitialData(mapped)
      })
      .catch(() => setNotFound(true))
  }, [storeId, token, productId])

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3 text-gray-500">
        <p className="text-sm">상품을 찾을 수 없습니다</p>
        <button onClick={() => router.back()} className="text-sm text-green-primary underline">
          돌아가기
        </button>
      </div>
    )
  }

  if (!initialData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-green-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <ProductForm
      mode="edit"
      productId={productId}
      storeId={storeId}
      token={token}
      initialData={initialData}
      onSuccess={() => router.push('/products')}
    />
  )
}
