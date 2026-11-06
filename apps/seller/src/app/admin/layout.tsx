import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isFeatureOn } from '@/lib/features';
import { AdminShell } from './_components/AdminShell';
import { buildAdminNavGroups } from './_components/navItems';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user || session.user.role !== 'admin') {
    redirect('/orders');
  }

  return (
    <AdminShell
      groups={buildAdminNavGroups({
        partnerInquiry: isFeatureOn('partner-inquiry'),
        reviews: isFeatureOn('reviews'),
      })}
      showSellerLink={Boolean(session.user.storeId)}
    >
      {children}
    </AdminShell>
  );
}
