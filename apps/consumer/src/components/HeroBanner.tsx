import type { ActiveBannersResponse, AdminBanner } from '@greenhub/shared';
import HeroBannerCarousel from './HeroBannerCarousel';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function toSlides(data: ActiveBannersResponse): AdminBanner[] {
  const scheduled = Array.isArray(data.scheduled) ? data.scheduled : [];
  return data.default ? [...scheduled, data.default] : scheduled;
}

export default async function HeroBanner() {
  let slides: AdminBanner[] = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${API_URL}/banners/active`, {
      next: { revalidate: 60 },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as ActiveBannersResponse;
      slides = toSlides(data);
    }
  } catch {}

  if (slides.length === 0) return null;

  return <HeroBannerCarousel slides={slides} />;
}
