import { notFound } from 'next/navigation';
import { isLocalPreviewEnabled } from '@/lib/local-preview';
import { OverlayCheck } from './_overlays';

// 창 초점 검사 화면(scripts/visual/focus-trap.mjs --set overlays): 앱 화면이 아직 쓰지 않는 @greenhub/ui 창(Sheet)을
// 버튼으로 열어 초점 가두기·aria-modal·Esc 뒤 초점 복귀를 검사한다. 실제 화면이 쓰면 그 화면 fixture로 옮기고 지운다.
// 하네스·dev:local에서만 열린다. 운영 빌드와 운영 환경에서는 404다.
export const dynamic = 'force-dynamic';

export default function OverlayCheckPage() {
  if (!isLocalPreviewEnabled()) notFound();
  return <OverlayCheck />;
}
