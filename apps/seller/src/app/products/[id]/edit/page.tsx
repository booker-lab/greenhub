'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import ProductForm from '../../_components/ProductForm'
import type { ProductFormData } from '../../_components/ProductForm'
import { Box, Group, Loader, Stack, Text, UnstyledButton } from '@mantine/core'

// Firestore Timestamp | ISO string → YYYY-MM-DD
function toISODate(value: unknown): Date | null {
  if (!value) return null
  if (typeof value === 'string') return new Date(value)
  if (typeof value === 'object' && value !== null && 'seconds' in value)
    return new Date((value as { seconds: number }).seconds * 1000)
  return null
}

// datetime-local 입력용: "YYYY-MM-DDTHH:mm" (로컬 시간)
function toDateTimeLocalStr(value: unknown): string {
  const d = toISODate(value)
  if (!d) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// date 입력용: "YYYY-MM-DD" (로컬 날짜)
function toDateStr(value: unknown): string {
  const d = toISODate(value)
  if (!d) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
            recruitDeadline: toDateTimeLocalStr(data.groupConfig.recruitDeadline),
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
      <Box style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text size="sm" c="dimmed">상품을 찾을 수 없습니다</Text>
        <UnstyledButton onClick={() => router.back()} style={{ color: 'var(--green-primary)', textDecoration: 'underline', fontSize: 14 }}>
          돌아가기
        </UnstyledButton>
      </Box>
    )
  }

  if (!initialData) {
    return (
      <Box style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader size="sm" color="var(--green-primary)" />
      </Box>
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
