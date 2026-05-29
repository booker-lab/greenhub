'use client';

import { Box, Loader, Paper, Text } from '@mantine/core';
import Image from 'next/image';
import type React from 'react';

interface BannerImageSectionProps {
  imageUrl?: string;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string | null;
}

export function BannerImageSection({
  imageUrl,
  uploading,
  onUpload,
  error,
}: BannerImageSectionProps) {
  return (
    <Paper radius="lg" shadow="xs" p="lg" style={{ border: '1px solid var(--color-border)' }}>
      <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }} mb="sm">
        배경 이미지
      </Text>
      {imageUrl && (
        <Box
          mb="sm"
          style={{ borderRadius: 12, overflow: 'hidden', height: 180, position: 'relative' }}
        >
          <Image
            fill
            src={imageUrl}
            alt="배너 미리보기"
            sizes="100vw"
            style={{ objectFit: 'cover' }}
          />
        </Box>
      )}
      <Box
        component="label"
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
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={onUpload}
          disabled={uploading}
        />
      </Box>
      {error && (
        <Text mt="xs" size="sm" c="red">
          {error}
        </Text>
      )}
    </Paper>
  );
}
