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
        // ② 사진 장수는 사진 아래 점으로 보여 준다(design-direction.md §4.3). 지금 사진은 검정 점(§3.2 선택 표시),
        // 나머지는 회색 점이다. 점마다 터치 영역 44px 높이의 버튼이라 눌러서 그 사진으로 넘길 수 있다.
        <div className="flex flex-row items-center justify-center" style={{ height: 44 }}>
          {displayImages.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${i + 1}번째 사진 보기`}
              aria-current={activeIdx === i ? 'true' : undefined}
              onClick={() => {
                setActiveIdx(i);
                carouselRef.current?.scrollTo({
                  left: i * carouselRef.current.offsetWidth,
                  behavior: 'smooth',
                });
              }}
              className="flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary focus-visible:outline-solid"
              style={{ width: 20, height: 44 }}
            >
              <span
                aria-hidden
                style={{
                  background: activeIdx === i ? 'var(--color-text)' : 'var(--color-text-disabled)',
                  borderRadius: 'var(--radius-full)',
                  display: 'block',
                  height: 7,
                  width: 7,
                }}
              />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
