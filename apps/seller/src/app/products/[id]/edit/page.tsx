'use client';

import { Box, Text, UnstyledButton } from '@mantine/core';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { LoadingState } from '@/components/StateViews';
import { getApiBaseUrl } from '@/lib/api-base-url';
import type { ProductFormData } from '../../_components/ProductForm';
import ProductForm from '../../_components/ProductForm';

// Firestore Timestamp | ISO string → YYYY-MM-DD
function toISODate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === 'string') return new Date(value);
  if (typeof value === 'object' && value !== null && 'seconds' in value)
    return new Date((value as { seconds: number }).seconds * 1000);
  return null;
}

// datetime-local 입력용: "YYYY-MM-DDTHH:mm" (로컬 시간)
function toDateTimeLocalStr(value: unknown): string {
  const d = toISODate(value);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// date 입력용: "YYYY-MM-DD" (로컬 날짜)
function toDateStr(value: unknown): string {
  const d = toISODate(value);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function EditProductPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? '';
  const token = session?.user.accessToken ?? '';

  const [initialData, setInitialData] = useState<Partial<ProductFormData> | undefined>();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!storeId || !token || !productId) return;

    fetch(`${getApiBaseUrl()}/stores/${storeId}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        const mapped: Partial<ProductFormData> = {
          name: data.name ?? '',
          category: data.category ?? 'cut_flower',
          deliverySize: data.deliverySize ?? 'small',
          price: String(data.price ?? ''),
          saleType: data.saleType ?? 'normal',
          images: data.images ?? [],
          varietyId: data.varietyId ?? '',
          selection: data.selection
            ? { careLevel: 'normal', ...data.selection }
            : {
                colors: data.colors ?? [],
                fragrance: 'none',
                bloomCondition: 'half',
                careLevel: 'normal',
                bundleUnit: '',
              },
          sellerNote: data.sellerNote ?? data.description ?? '',
          content: data.content ?? {
            headline: data.name ?? '',
            description: data.description ?? '',
            isEditedByUser: true,
          },
          sellerOverride: data.sellerOverride ?? false,
        };
        if (data.groupConfig) {
          mapped.groupConfig = {
            minQuantity: String(data.groupConfig.minQuantity ?? ''),
            targetQuantity: String(data.groupConfig.targetQuantity ?? ''),
            maxPerPerson: String(data.groupConfig.maxPerPerson ?? ''),
            recruitDeadline: toDateTimeLocalStr(data.groupConfig.recruitDeadline),
            groupDeliveryDate: toDateStr(data.groupConfig.groupDeliveryDate),
            groupDeliveryMethod: data.groupConfig.groupDeliveryMethod ?? 'direct',
          };
        }
        setInitialData(mapped);
      })
      .catch(() => setNotFound(true));
  }, [storeId, token, productId]);

  if (notFound) {
    return (
      <Box
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--color-surface-muted)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          상품을 찾을 수 없습니다
        </Text>
        <UnstyledButton
          onClick={() => router.back()}
          style={{
            color: 'var(--color-primary)',
            textDecoration: 'underline',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          돌아가기
        </UnstyledButton>
      </Box>
    );
  }

  if (!initialData) {
    return <LoadingState fullPage />;
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
  );
}
