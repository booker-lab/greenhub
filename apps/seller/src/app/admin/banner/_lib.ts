import type { AdminBanner, AdminBannerForm } from '@/hooks/useAdmin';

export const DEFAULT_BANNER_FORM: AdminBannerForm = {
  kind: 'scheduled',
  imageUrl: '',
  tagText: '',
  headline: '',
  subText: '',
  cta1: { label: '', href: '' },
  cta2: { label: '', href: '' },
  startDate: '',
  endDate: '',
};

export const DEFAULT_BANNER_ID = 'main_hero';

export const BANNER_KIND_LABEL = {
  default: '기본',
  scheduled: '기간',
} as const;

export const BANNER_STATUS_LABEL = {
  default: '기본',
  active: '노출 중',
  upcoming: '예정',
  expired: '만료',
} as const;

export const BANNER_STATUS_COLOR = {
  default: 'green',
  active: 'blue',
  upcoming: 'cyan',
  expired: 'gray',
} as const;

export type BannerStatus = keyof typeof BANNER_STATUS_LABEL;

function hasPartialCta(cta?: { label?: string; href?: string }) {
  const hasLabel = Boolean(cta?.label?.trim());
  const hasHref = Boolean(cta?.href?.trim());
  return hasLabel !== hasHref;
}

export function validateBannerForm(form: AdminBannerForm): string | null {
  if (hasPartialCta(form.cta1) || hasPartialCta(form.cta2)) {
    return '버튼 문구와 URL은 둘 다 입력하거나 둘 다 비워주세요.';
  }
  if (form.kind === 'scheduled') {
    if (!form.startDate || !form.endDate) return '기간 배너는 시작일과 종료일이 필요합니다.';
    if (form.endDate < form.startDate) return '종료일은 시작일보다 빠를 수 없습니다.';
  }
  return null;
}

export function bannerToForm(banner: AdminBanner): AdminBannerForm {
  return {
    ...DEFAULT_BANNER_FORM,
    ...banner,
    cta1: { label: banner.cta1?.label ?? '', href: banner.cta1?.href ?? '' },
    cta2: { label: banner.cta2?.label ?? '', href: banner.cta2?.href ?? '' },
  };
}

export function newScheduledBannerForm(): AdminBannerForm {
  return { ...DEFAULT_BANNER_FORM, kind: 'scheduled' };
}

export function getBannerStatus(banner: AdminBanner, today: string): BannerStatus {
  if (banner.kind === 'default') return 'default';
  if (banner.endDate && banner.endDate < today) return 'expired';
  if (banner.startDate && banner.startDate > today) return 'upcoming';
  return 'active';
}

export function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function formatBannerPeriod(banner: AdminBanner | AdminBannerForm) {
  if (banner.kind === 'default') return '상시 기본 배너';
  if (!banner.startDate || !banner.endDate) return '기간 미설정';
  return `${banner.startDate} ~ ${banner.endDate}`;
}
