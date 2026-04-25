'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Box } from '@mantine/core'

interface Props {
  images: string[]
  name: string
}

export default function ProductImages({ images, name }: Props) {
  const displayImages = images.length ? images : ['/icons/icon-192x192.png']
  const [activeIdx, setActiveIdx] = useState(0)
  const carouselRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <Box
        ref={carouselRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setActiveIdx(Math.round(el.scrollLeft / el.offsetWidth))
        }}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          aspectRatio: '4/5',
          background: 'var(--color-surface-muted)',
        }}
      >
        {displayImages.map((src, i) => (
          <Box
            key={i}
            style={{ flexShrink: 0, width: '100%', scrollSnapAlign: 'start', aspectRatio: '4/5', overflow: 'hidden', position: 'relative' }}
          >
            <Image
              fill
              src={src}
              alt={`${name} ${i + 1}`}
              sizes="100vw"
              priority={i === 0}
              style={{ objectFit: 'cover' }}
            />
          </Box>
        ))}
      </Box>

      {displayImages.length > 1 && (
        <Box style={{ display: 'flex', gap: 6, padding: '8px 12px', overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', background: 'var(--color-surface-muted)' }}>
          {displayImages.map((src, i) => (
            <Box
              key={i}
              onClick={() => {
                setActiveIdx(i)
                carouselRef.current?.scrollTo({ left: i * carouselRef.current.offsetWidth, behavior: 'smooth' })
              }}
              style={{
                flexShrink: 0, width: 56, height: 56, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                border: activeIdx === i ? '2px solid var(--color-primary)' : '2px solid transparent',
                transition: 'border-color 0.15s', position: 'relative',
              }}
            >
              <Image fill src={src} alt={`${name} 썸네일 ${i + 1}`} sizes="56px" style={{ objectFit: 'cover' }} />
            </Box>
          ))}
        </Box>
      )}
    </>
  )
}
