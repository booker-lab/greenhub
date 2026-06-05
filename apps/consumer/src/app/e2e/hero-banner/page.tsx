import type { AdminBanner } from '@greenhub/shared';
import { notFound } from 'next/navigation';
import HeroBannerCarousel from '@/components/HeroBannerCarousel';

const SLIDES: AdminBanner[] = [
  {
    id: 'scheduled_new',
    kind: 'scheduled',
    tagText: '기간 한정',
    headline: '최신 기간 배너',
    subText: '가장 먼저 노출됩니다.',
  },
  {
    id: 'scheduled_old',
    kind: 'scheduled',
    tagText: '기간 한정',
    headline: '이전 기간 배너',
    subText: '두 번째로 노출됩니다.',
  },
  {
    id: 'main_hero',
    kind: 'default',
    tagText: '기본',
    headline: '기본 배너',
    subText: '마지막에 노출됩니다.',
  },
];

export default function HeroBannerFixturePage() {
  if (process.env.ENABLE_E2E_FIXTURES !== 'true') notFound();

  return <HeroBannerCarousel slides={SLIDES} />;
}
