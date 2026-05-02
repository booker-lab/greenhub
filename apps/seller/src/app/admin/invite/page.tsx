'use client';
import dynamic from 'next/dynamic';

const AdminInviteClient = dynamic(() => import('./_client'), { ssr: false });

export default function AdminInvitePage() {
  return <AdminInviteClient />;
}
