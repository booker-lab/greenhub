'use client'

import dynamic from 'next/dynamic'

const NotificationsClient = dynamic(() => import('./_client'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: '60px 24px', textAlign: 'center', color: '#999' }}>로딩 중...</div>
  ),
})

export default function NotificationsPage() {
  return <NotificationsClient />
}
