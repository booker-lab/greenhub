import Link from 'next/link';
import { Box } from '@mantine/core';
import ResilientImage from '@/components/ResilientImage';
import { getApiBaseUrl } from '@/lib/api-base-url';

interface BannerCta {
  label: string;
  href: string;
}

interface Banner {
  imageUrl?: string;
  tagText?: string;
  headline?: string;
  subText?: string;
  cta1?: BannerCta;
  cta2?: BannerCta;
  isActive?: boolean;
}

const API_URL = getApiBaseUrl();

export default async function HeroBanner() {
  let banner: Banner | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${API_URL}/banner`, {
      next: { revalidate: 60 },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data?.isActive) banner = data;
    }
  } catch {}

  if (!banner) return null;

  return (
    // 글자와 사진을 나란히 놓는다. 사진을 글자 밑에 깔면 좁은 화면에서 제목·버튼이 사진 위로 겹친다.
    <Box
      mb="lg"
      style={{
        display: 'flex',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        backgroundColor: 'var(--color-primary-surface)',
        minHeight: 200,
      }}
    >
      <Box style={{ flex: '1 1 0', minWidth: 0, padding: '24px 16px 24px 20px' }}>
        {banner.tagText && (
          <span
            style={{
              display: 'inline-block',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-text-secondary)',
              backgroundColor: 'rgba(255,255,255,0.7)',
              padding: '2px 10px',
              borderRadius: 'var(--radius-full)',
              marginBottom: 8,
            }}
          >
            {banner.tagText}
          </span>
        )}

        {banner.headline && (
          <p
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--fw-bold)',
              lineHeight: 1.3,
              color: 'var(--color-text)',
              whiteSpace: 'pre-line',
              wordBreak: 'keep-all',
              margin: '0 0 8px',
            }}
          >
            {banner.headline}
          </p>
        )}

        {banner.subText && (
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-line',
              wordBreak: 'keep-all',
              margin: '0 0 16px',
            }}
          >
            {banner.subText}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {banner.cta1?.label && (
            <Link
              href={banner.cta1.href}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 'var(--touch-target)',
                padding: '0 20px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-bg)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                textDecoration: 'none',
              }}
            >
              {banner.cta1.label}
            </Link>
          )}
          {banner.cta2?.label && (
            <Link
              href={banner.cta2.href}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 'var(--touch-target)',
                padding: '0 20px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-primary-dark)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                textDecoration: 'none',
                border: 'var(--border)',
              }}
            >
              {banner.cta2.label}
            </Link>
          )}
        </div>
      </Box>

      {banner.imageUrl && (
        <div style={{ position: 'relative', flex: '0 0 40%' }}>
          <ResilientImage
            fill
            src={banner.imageUrl}
            alt="배너"
            sizes="(max-width: 430px) 40vw, 172px"
            preload
            style={{ objectFit: 'cover', objectPosition: 'center' }}
          />
        </div>
      )}
    </Box>
  );
}
