'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import ProductForm from '../_components/ProductForm';

export default function NewProductPage() {
  const { data: session } = useSession();
  const router = useRouter();

  return (
    <ProductForm
      mode="create"
      storeId={session?.user.storeId ?? ''}
      token={session?.user.accessToken ?? ''}
      onSuccess={() => router.push('/products')}
    />
  );
}
