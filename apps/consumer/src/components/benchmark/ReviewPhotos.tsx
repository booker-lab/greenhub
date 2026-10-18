'use client';

import { Group } from '@mantine/core';
import { HideOnErrorImage } from '@/components/ResilientImage';

// 후기 사진 줄. 서명 URL은 한 시간 뒤 만료되므로 읽지 못한 사진은 조용히 감춘다.

export function ReviewPhotoStrip({ urls, label }: { urls?: readonly string[]; label: string }) {
  if (!urls || urls.length === 0) return null;
  return (
    <Group gap={6} mt={6} wrap="nowrap">
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
    </Group>
  );
}
