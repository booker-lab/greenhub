'use client';

import dynamic from 'next/dynamic';

const DriversClient = dynamic(() => import('./_client'), { ssr: false });

export default function AdminDriversPage() {
  return <DriversClient />;
}
