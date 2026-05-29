export const BANNER_KINDS = ['default', 'scheduled'] as const;

export type BannerKind = (typeof BANNER_KINDS)[number];

export interface BannerCta {
  label?: string;
  href?: string;
}

export interface AdminBanner {
  id: string;
  kind: BannerKind;
  imageUrl?: string;
  tagText?: string;
  headline?: string;
  subText?: string;
  cta1?: BannerCta;
  cta2?: BannerCta;
  startDate?: string;
  endDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ActiveBannersResponse {
  scheduled: AdminBanner[];
  default: AdminBanner | null;
}
