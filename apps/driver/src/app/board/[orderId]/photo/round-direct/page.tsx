import { Suspense } from 'react';
import PhotoCapture from '../photo-capture';

export default async function RoundDirectPhotoPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <Suspense fallback={<div style={{ minHeight: '100dvh', backgroundColor: '#000' }} />}>
      <PhotoCapture orderId={orderId} mode="round-direct" />
    </Suspense>
  );
}
