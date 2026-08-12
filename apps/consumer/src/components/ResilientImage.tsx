'use client';

import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import Image, { type ImageProps } from 'next/image';

export const PRODUCT_IMAGE_FALLBACK = '/icons/icon-192x192.png';

type ImagePhase = 'primary' | 'fallback' | 'terminal';

interface ResilientImageProps extends Omit<ImageProps, 'src' | 'onError'> {
  src: ImageProps['src'];
  fallbackSrc?: ImageProps['src'];
  fallback?: ReactNode;
}

export default function ResilientImage({
  src,
  fallbackSrc,
  fallback,
  ...imageProps
}: ResilientImageProps) {
  const [phase, setPhase] = useState<ImagePhase>('primary');

  if (phase === 'terminal') {
    return fallback ?? null;
  }

  const currentSrc = phase === 'fallback' && fallbackSrc ? fallbackSrc : src;

  function handleError() {
    setPhase((currentPhase) => {
      if (currentPhase === 'primary' && fallbackSrc && fallbackSrc !== src) {
        return 'fallback';
      }
      return 'terminal';
    });
  }

  return <Image {...imageProps} src={currentSrc} onError={handleError} />;
}

interface HideOnErrorImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'onError'> {
  alt: string;
}

export function HideOnErrorImage({ alt, ...imageProps }: HideOnErrorImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  // biome-ignore lint/performance/noImgElement: 크기를 미리 알 수 없는 자유 비율 상세 이미지는 원본 비율을 유지해야 한다.
  return <img {...imageProps} alt={alt} onError={() => setFailed(true)} />;
}
