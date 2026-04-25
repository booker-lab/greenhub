'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Box } from '@mantine/core'

interface BannerCta {
  label: string
  href: string
}

interface Banner {
  imageUrl?: string
  tagText?: string
  headline?: string
  subText?: string
  cta1?: BannerCta
  cta2?: BannerCta
  isActive?: boolean
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export default function HeroBanner() {
  const [banner, setBanner] = useState<Banner | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/banner`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.isActive) setBanner(data) })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) return (
    <Box
      mb="lg"
      style={{
        minHeight: 200,
        borderRadius: 'var(--radius)',
        background: 'var(--color-primary-surface)',
      }}
    />
  )

  if (!banner) return null

  return (
    <Box
      mb="lg"
      style={{
        position: 'relative',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        backgroundColor: 'var(--color-primary-surface)',
        minHeight: 200,
      }}
    >
      {banner.imageUrl && (
        <div style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '100%' }}>
          <Image
            fill
            src={banner.imageUrl}
            alt="배너"
            sizes="50vw"
            priority
            style={{ objectFit: 'cover', objectPosition: 'center' }}
          />
        </div>
      )}

      <Box style={{ position: 'relative', zIndex: 1, padding: '24px 20px' }}>
        {banner.tagText && (
          <span style={{
            display: 'inline-block',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--color-text-secondary)',
            backgroundColor: 'rgba(255,255,255,0.7)',
            padding: '2px 10px',
            borderRadius: 'var(--radius-full)',
            marginBottom: 8,
          }}>
            {banner.tagText}
          </span>
        )}

        {banner.headline && (
          <p style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--fw-bold)',
            lineHeight: 1.3,
            color: 'var(--color-text)',
            whiteSpace: 'pre-line',
            margin: '0 0 8px',
          }}>
            {banner.headline}
          </p>
        )}

        {banner.subText && (
          <p style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-line',
            margin: '0 0 16px',
          }}>
            {banner.subText}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {banner.cta1?.label && (
            <Box
              component={Link}
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
            </Box>
          )}
          {banner.cta2?.label && (
            <Box
              component={Link}
              href={banner.cta2.href}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 'var(--touch-target)',
                padding: '0 20px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-primary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                textDecoration: 'none',
                border: 'var(--border)',
              }}
            >
              {banner.cta2.label}
            </Box>
          )}
        </div>
      </Box>
    </Box>
  )
}
