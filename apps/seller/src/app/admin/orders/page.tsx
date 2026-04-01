import dynamic from 'next/dynamic'

const AdminOrdersClient = dynamic(() => import('./_client'), { ssr: false })

export default function AdminOrdersPage() {
  return <AdminOrdersClient />
}
