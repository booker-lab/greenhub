'use client'

import dynamic from 'next/dynamic'

const AddressesClient = dynamic(() => import('./_client'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--color-text-disabled)' }}>로딩 중...</div>
  ),
})

export default function AddressesPage() {
  return <AddressesClient />
}
