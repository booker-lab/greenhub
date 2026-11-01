'use client';

import { HideOnErrorImage } from '@/components/ResilientImage';

// 후기 사진 줄. 서명 URL은 한 시간 뒤 만료되므로 읽지 못한 사진은 조용히 감춘다.

export function ReviewPhotoStrip({ urls, label }: { urls?: readonly string[]; label: string }) {
  if (!urls || urls.length === 0) return null;
  return (
    // ① 외형 유지(UI 교체 P5): Mantine Group(gap 6·mt 6·wrap nowrap) 값.
    <div className="mt-1.5 flex items-center justify-start gap-1.5">
      {urls.map((url, index) => (
        <HideOnErrorImage
          key={url}
          src={url}
          alt={`${label} 사진 ${index + 1}`}
          loading="lazy"
          width={72}
          height={72}
          style={{ borderRadius: 'var(--radius-sm)', height: 72, objectFit: 'cover', width: 72 }}
        />
      ))}
    </div>
  );
}
