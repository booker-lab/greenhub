'use client';
import dynamic from 'next/dynamic';

const AdminUsersClient = dynamic(() => import('./_client'), { ssr: false });

export default function AdminUsersPage() {
  return <AdminUsersClient />;
}
