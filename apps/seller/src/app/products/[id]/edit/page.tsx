'use client';

import { apiPathSegment, readRouteParam } from '@greenhub/shared';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { LoadingState } from '@/components/StateViews';
import { getApiBaseUrl } from '@/lib/api-base-url';
import type { ProductFormData } from '../../_components/ProductForm';
import ProductForm from '../../_components/ProductForm';
import { extrasFromProduct } from '../../_components/productExtras';
import { useTokenRef } from '@/lib/use-token-ref';

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
  // 경로 파라미터는 형식을 검사한 원래 ID로 읽는다. 맞지 않으면 요청하지 않고 "찾을 수 없음"을 보여 준다.
  const productId = readRouteParam(params.id);
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? '';
  const token = session?.user.accessToken ?? '';

  const [initialData, setInitialData] = useState<Partial<ProductFormData> | undefined>();
  const [notFound, setNotFound] = useState(false);
  // 토큰 갱신만으로 상품을 다시 읽어 수정 중인 폼을 덮지 않는다.
  const { tokenRef, hasToken } = useTokenRef(token);

  useEffect(() => {
    if (!storeId || !hasToken || !productId) return;
    const requestToken = tokenRef.current;

    // 경로 조각 검증 실패도 요청 없이 아래 catch(찾을 수 없음)로 모인다.
    Promise.resolve()
      .then(() =>
        fetch(
          `${getApiBaseUrl()}/stores/${apiPathSegment(storeId)}/products/${apiPathSegment(productId)}/owner`,
          { headers: { Authorization: `Bearer ${requestToken}` } },
        ),
      )
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
          extras: extrasFromProduct(data),
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
  }, [storeId, hasToken, productId, tokenRef]);

  if (notFound || !productId) {
    return (
      // ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·UnstyledButton 값.
      <div
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
        <p
          className="m-0 p-0 text-base font-normal"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          상품을 찾을 수 없습니다
        </p>
        <button
          type="button"
          onClick={() => router.back()}
          className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
          style={{
            color: 'var(--color-primary-dark)',
            textDecoration: 'underline',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          돌아가기
        </button>
      </div>
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
