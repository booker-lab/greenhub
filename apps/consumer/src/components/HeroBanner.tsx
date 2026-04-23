'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Box, Text } from '@mantine/core'

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

  useEffect(() => {
    fetch(`${API_URL}/banner`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.isActive) setBanner(data) })
      .catch(() => {})
  }, [])

  if (!banner) return null

  return (
    <Box
      mb="lg"
      style={{
        position: 'relative',
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#F5F2EE',
        minHeight: 200,
      }}
    >
      {banner.imageUrl && (
        <img
          src={banner.imageUrl}
          alt="배너"
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            height: '100%',
            width: '50%',
            objectFit: 'cover',
            objectPosition: 'center',
          }}
        />
      )}

      <Box style={{ position: 'relative', zIndex: 1, padding: '24px 20px' }}>
        {banner.tagText && (
          <Text
            size="xs"
            fw={600}
            mb={8}
            style={{
              display: 'inline-block',
              backgroundColor: 'rgba(255,255,255,0.7)',
              padding: '2px 10px',
              borderRadius: 20,
              color: 'var(--mantine-color-gray-7)',
            }}
          >
            {banner.tagText}
          </Text>
        )}

        {banner.headline && (
          <Text
            fw={800}
            lh={1.3}
            mb={8}
            style={{ fontSize: 22, whiteSpace: 'pre-line', color: '#1a1a1a' }}
          >
            {banner.headline}
          </Text>
        )}

        {banner.subText && (
          <Text size="xs" c="gray.6" mb={16} style={{ whiteSpace: 'pre-line' }}>
            {banner.subText}
          </Text>
        )}

        <Box style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {banner.cta1?.label && (
            <Box
              component={Link}
              href={banner.cta1.href}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                backgroundColor: 'var(--green-primary, #3d8b5e)',
                color: 'white',
                fontSize: 13,
                fontWeight: 600,
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
                padding: '8px 16px',
                borderRadius: 20,
                backgroundColor: 'white',
                color: 'var(--green-primary, #3d8b5e)',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                border: '1px solid var(--green-primary, #3d8b5e)',
              }}
            >
              {banner.cta2.label}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}
