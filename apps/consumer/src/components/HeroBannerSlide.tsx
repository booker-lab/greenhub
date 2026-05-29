import type { AdminBanner, BannerCta } from '@greenhub/shared';
import { Box } from '@mantine/core';
import Image from 'next/image';
import Link from 'next/link';

interface HeroBannerSlideProps {
  banner: AdminBanner;
  priority?: boolean;
}

function hasCta(cta: BannerCta | undefined): cta is Required<BannerCta> {
  return Boolean(cta?.label && cta.href);
}

function HeroCta({ cta, variant }: { cta: Required<BannerCta>; variant: 'primary' | 'secondary' }) {
  const isPrimary = variant === 'primary';

  return (
    <Link
      href={cta.href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 'var(--touch-target)',
        padding: '0 20px',
        borderRadius: 'var(--radius-full)',
        backgroundColor: isPrimary ? 'var(--color-primary)' : 'var(--color-bg)',
        color: isPrimary ? 'var(--color-bg)' : 'var(--color-primary)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--fw-bold)',
        textDecoration: 'none',
        border: isPrimary ? undefined : 'var(--border)',
      }}
    >
      {cta.label}
    </Link>
  );
}

export default function HeroBannerSlide({ banner, priority = false }: HeroBannerSlideProps) {
  const cta1 = hasCta(banner.cta1) ? banner.cta1 : null;
  const cta2 = hasCta(banner.cta2) ? banner.cta2 : null;

  return (
    <Box
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'var(--color-primary-surface)',
        minHeight: 200,
        height: '100%',
      }}
    >
      {banner.imageUrl && (
        <div style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%' }}>
          <Image
            fill
            src={banner.imageUrl}
            alt="배너"
            sizes="50vw"
            priority={priority}
            style={{ objectFit: 'cover', objectPosition: 'center' }}
          />
        </div>
      )}

      <Box style={{ position: 'relative', zIndex: 1, padding: '24px 20px' }}>
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
              margin: '0 0 16px',
            }}
          >
            {banner.subText}
          </p>
        )}

        {(cta1 || cta2) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {cta1 && <HeroCta cta={cta1} variant="primary" />}
            {cta2 && <HeroCta cta={cta2} variant="secondary" />}
          </div>
        )}
      </Box>
    </Box>
  );
}
