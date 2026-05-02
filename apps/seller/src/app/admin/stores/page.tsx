'use client';
import dynamic from 'next/dynamic';

const AdminStoresClient = dynamic(() => import('./_client'), { ssr: false });

export default function AdminStoresPage() {
  return <AdminStoresClient />;
}
