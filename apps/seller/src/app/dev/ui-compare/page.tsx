import { notFound } from 'next/navigation';
import { isLocalPreviewEnabled } from '@/lib/local-preview';
import { UiCompare } from './_compare';

// UI 교체 대조 화면(ui-stack-migration-plan.md §6 P1·P2a): @greenhub/ui 컴포넌트를 같은 크기의 Mantine 옆에 그린다.
// 하네스·dev:local에서만 열린다. 운영 빌드와 운영 환경에서는 404다.
export const dynamic = 'force-dynamic';

export default async function UiComparePage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  if (!isLocalPreviewEnabled()) notFound();
  const { open } = await searchParams;
  return <UiCompare open={open} />;
}
