'use client';

import type { AdminBanner } from '@greenhub/shared';
import { ActionIcon, Box, Group, Tooltip } from '@mantine/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import HeroBannerSlide from './HeroBannerSlide';

interface HeroBannerCarouselProps {
  slides: AdminBanner[];
}

const AUTO_INTERVAL_MS = 5000;

export default function HeroBannerCarousel({ slides }: HeroBannerCarouselProps) {
  const [active, setActive] = useState(0);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [interactionStopped, setInteractionStopped] = useState(false);
  const hasMultipleSlides = slides.length > 1;

  useEffect(() => {
    if (!hasMultipleSlides || hoverPaused || interactionStopped) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, AUTO_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [hasMultipleSlides, hoverPaused, interactionStopped, slides.length]);

  if (!hasMultipleSlides) {
    return (
      <Box mb="lg" style={{ borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <HeroBannerSlide banner={slides[0]} priority />
      </Box>
    );
  }

  const moveTo = (next: number) => {
    setInteractionStopped(true);
    setActive((next + slides.length) % slides.length);
  };

  return (
    <Box
      aria-roledescription="carousel"
      aria-label="프로모션 배너"
      mb="lg"
      onFocus={() => setHoverPaused(true)}
      onBlur={() => setHoverPaused(false)}
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      style={{
        position: 'relative',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        backgroundColor: 'var(--color-primary-surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          transform: `translateX(-${active * 100}%)`,
          transition: 'transform 260ms ease',
        }}
      >
        {slides.map((banner, index) => (
          <div
            key={banner.id}
            aria-hidden={index !== active}
            style={{ minWidth: '100%', height: '100%' }}
          >
            <HeroBannerSlide banner={banner} priority={index === 0} />
          </div>
        ))}
      </div>

      <Group
        justify="space-between"
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          inset: '0 8px',
        }}
      >
        <Tooltip label="이전 배너">
          <ActionIcon
            aria-label="이전 배너"
            color="gray"
            onClick={() => moveTo(active - 1)}
            radius="xl"
            size="lg"
            style={{ pointerEvents: 'auto', backgroundColor: 'rgba(255,255,255,.78)' }}
            variant="subtle"
          >
            <ChevronLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="다음 배너">
          <ActionIcon
            aria-label="다음 배너"
            color="gray"
            onClick={() => moveTo(active + 1)}
            radius="xl"
            size="lg"
            style={{ pointerEvents: 'auto', backgroundColor: 'rgba(255,255,255,.78)' }}
            variant="subtle"
          >
            <ChevronRight size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Group
        aria-label="배너 페이지"
        gap={6}
        justify="center"
        role="tablist"
        style={{ position: 'absolute', bottom: 10, left: 0, right: 0 }}
      >
        {slides.map((banner, index) => (
          <button
            key={banner.id}
            aria-label={`${index + 1}번째 배너 보기`}
            aria-selected={index === active}
            onClick={() => moveTo(index)}
            role="tab"
            style={{
              width: index === active ? 18 : 7,
              height: 7,
              border: 0,
              borderRadius: 999,
              backgroundColor: index === active ? 'var(--color-primary)' : 'rgba(255,255,255,.76)',
              cursor: 'pointer',
              padding: 0,
              transition: 'width 160ms ease',
            }}
            type="button"
          />
        ))}
      </Group>
    </Box>
  );
}
