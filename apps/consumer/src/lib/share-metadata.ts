import type { Metadata } from 'next';

// 당근·카카오톡에 링크를 붙였을 때 보이는 미리보기(Open Graph) 정보.
export const SITE_URL = 'https://greenlove.co.kr';
export const SITE_NAME = '그린러브';
export const SITE_SHARE_DESCRIPTION = '월요일 경매 당일 매입, 화요일 오전 이천 문 앞 배송';
export const DEFAULT_SHARE_IMAGE = '/icons/icon-512x512.png';

const MAX_DESCRIPTION_LENGTH = 80;

export interface ShareableProduct {
  name?: unknown;
  description?: unknown;
  images?: unknown;
}

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const image = images.find((value) => typeof value === 'string' && /^https:\/\//.test(value));
  return typeof image === 'string' ? image : null;
}

function shortDescription(value: unknown): string {
  if (typeof value !== 'string') return SITE_SHARE_DESCRIPTION;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return SITE_SHARE_DESCRIPTION;
  return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}…` : text;
}

/** 상품 정보로 미리보기 메타데이터를 만든다. 이름이 없으면 null(사이트 기본값 사용). */
export function buildProductShareMetadata(product: ShareableProduct): Metadata | null {
  if (typeof product.name !== 'string' || !product.name.trim()) return null;
  const title = `${product.name.trim()} | ${SITE_NAME}`;
  const description = shortDescription(product.description);
  const image = firstImage(product.images) ?? DEFAULT_SHARE_IMAGE;
  return {
    title,
    description,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'ko_KR',
      title,
      description,
      images: [{ url: image }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
