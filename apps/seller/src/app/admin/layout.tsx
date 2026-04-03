import { auth } from '@/auth'
import { redirect } from 'next/navigation'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user || session.user.role !== 'admin') {
    redirect('/orders')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">관리자 콘솔</h1>
          <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">
            ADMIN
          </span>
        </div>
        <nav className="max-w-4xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto">
          {[
            { href: '/admin/stores', label: '판매자' },
            { href: '/admin/users', label: '소비자' },
            { href: '/admin/drivers', label: '드라이버' },
            { href: '/admin/orders', label: '주문' },
            { href: '/admin/settlements', label: '정산' },
            { href: '/admin/invite', label: '초대' },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="shrink-0 px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
