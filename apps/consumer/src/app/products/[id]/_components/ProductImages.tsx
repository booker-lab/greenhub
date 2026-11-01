'use client';

import { useRef, useState } from 'react';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import { isFeatureOn } from '@/lib/features';

interface Props {
  images: string[];
  name: string;
}

export default function ProductImages({ images, name }: Props) {
  const displayImages = images.length ? images : [PRODUCT_IMAGE_FALLBACK];
  const detailImages = isFeatureOn('detail-images');
  const [activeIdx, setActiveIdx] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div
        ref={carouselRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActiveIdx(Math.round(el.scrollLeft / el.offsetWidth));
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
          <div
            key={i}
            style={{
              flexShrink: 0,
              width: '100%',
              scrollSnapAlign: 'start',
              aspectRatio: '4/5',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <ResilientImage
              fill
              src={src}
              fallbackSrc={PRODUCT_IMAGE_FALLBACK}
              alt={`${name} ${i + 1}`}
              // 상세 사진 정리(detail-images): 화면 폭만큼만 받고 첫 장을 먼저 요청한다.
              sizes={detailImages ? '(max-width: 720px) 100vw, 720px' : '100vw'}
              preload={i === 0}
              fetchPriority={detailImages && i === 0 ? 'high' : undefined}
              loading={detailImages && i > 0 ? 'lazy' : undefined}
              style={{ objectFit: 'cover' }}
            />
          </div>
        ))}
      </div>

      {displayImages.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 12px',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            background: 'var(--color-surface-muted)',
          }}
        >
          {displayImages.map((src, i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Mantine Box와 같은 마크업을 유지한다(① 외형 유지, 동작 변경 없음)
            <div
              key={i}
              onClick={() => {
                setActiveIdx(i);
                carouselRef.current?.scrollTo({
                  left: i * carouselRef.current.offsetWidth,
                  behavior: 'smooth',
                });
              }}
              style={{
                flexShrink: 0,
                width: 56,
                height: 56,
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                cursor: 'pointer',
                border:
                  activeIdx === i ? '2px solid var(--color-primary)' : '2px solid transparent',
                transition: 'border-color 0.15s',
                position: 'relative',
              }}
            >
              <ResilientImage
                fill
                src={src}
                fallbackSrc={PRODUCT_IMAGE_FALLBACK}
                alt={`${name} 썸네일 ${i + 1}`}
                sizes="56px"
                style={{ objectFit: 'cover' }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
