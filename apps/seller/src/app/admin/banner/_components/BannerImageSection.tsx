'use client';

import { Loader } from '@greenhub/ui/components/loader';
import Image from 'next/image';
import type React from 'react';

interface BannerImageSectionProps {
  imageUrl?: string;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// ① 외형 유지(UI 교체 P2b): Mantine Paper(lg·xs·lg)·Text·Box·Loader xs와 같은 값.
export function BannerImageSection({ imageUrl, uploading, onUpload }: BannerImageSectionProps) {
  return (
    <div
      className="block rounded-[16px] bg-white p-5 shadow-paper-xs"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <p
        className="m-0 mb-3 p-0 text-base"
        style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
      >
        배경 이미지
      </p>
      {imageUrl && (
        <div
          className="mb-3"
          style={{ borderRadius: 12, overflow: 'hidden', height: 180, position: 'relative' }}
        >
          <Image
            fill
            src={imageUrl}
            alt="배너 미리보기"
            sizes="100vw"
            style={{ objectFit: 'cover' }}
          />
        </div>
      )}
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 8,
          border: '1px solid var(--color-border)',
          cursor: uploading ? 'not-allowed' : 'pointer',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {uploading ? <Loader size="xs" /> : '이미지 업로드'}
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onUpload}
          disabled={uploading}
        />
      </label>
    </div>
  );
}
