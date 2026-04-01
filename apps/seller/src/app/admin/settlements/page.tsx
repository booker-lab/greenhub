import dynamic from 'next/dynamic'

const AdminSettlementsClient = dynamic(() => import('./_client'), { ssr: false })

export default function AdminSettlementsPage() {
  return <AdminSettlementsClient />
}
