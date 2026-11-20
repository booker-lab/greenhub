'use client';

import { Loader } from '@greenhub/ui/components/loader';
import Image from 'next/image';
import type React from 'react';

interface BannerImageSectionProps {
  imageUrl?: string;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// 배너 배경 이미지 구역 — 쉬는 상자 그림자 없이, 구역 제목(16/800)이 칸 이름보다 먼저 읽힌다(어드민 틀 규칙).
export function BannerImageSection({ imageUrl, uploading, onUpload }: BannerImageSectionProps) {
  return (
    <section className="block">
      <h2 className="m-0 mb-3 text-[16px] leading-[24px] font-extrabold">배경 이미지</h2>
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
      {/* 눌러지는 외곽선 버튼 모양(44px). 파일 입력은 sr-only라 Tab으로 가고, 키보드 초점이면 label에 검정 2px 링을 그린다. */}
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[8px] border border-input bg-background px-4 text-[15px] font-bold text-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ui-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:text-[var(--color-text-secondary)]">
        {uploading ? <Loader size="xs" /> : '이미지 업로드'}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onUpload}
          disabled={uploading}
        />
      </label>
    </section>
  );
}
