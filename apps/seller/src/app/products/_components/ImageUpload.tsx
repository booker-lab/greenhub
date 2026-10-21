'use client';

import { Box, Group, Loader, Paper, Text } from '@mantine/core';
import Image from 'next/image';
import { useRef, useState } from 'react';
import { getFirebaseStorage } from '@/lib/firebase';
import {
  ImageReencodeError,
  imageReencodeFailureMessage,
  PRODUCT_IMAGE_ENCODE,
  reencodeImageToJpeg,
} from './image-reencode';

interface ImageUploadProps {
  storeId: string;
  images: string[];
  onChange: (images: string[]) => void;
  onError: (msg: string) => void;
}

export default function ImageUpload({ storeId, images, onChange, onError }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB

  async function handleFiles(files: FileList | null) {
    if (!files || images.length >= 5) return;
    const toUpload = Array.from(files).slice(0, 5 - images.length);

    for (const file of toUpload) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        onError('JPG, PNG, WebP, GIF 파일만 업로드 가능합니다.');
        return;
      }
      if (file.size > MAX_SIZE) {
        onError('파일 크기는 5MB 이하만 가능합니다.');
        return;
      }
    }

    setUploading(true);
    try {
      const batchId = Date.now();
      // Storage SDK는 올릴 때만 불러온다.
      const [{ getDownloadURL, ref: storageRef, uploadBytes }, storage] = await Promise.all([
        import('firebase/storage'),
        getFirebaseStorage(),
      ]);
      // 사진을 한 장씩 처리한다. 동시에 디코드하면 휴대폰에서 원본 비트맵이 한꺼번에 메모리에 올라간다.
      const urls: string[] = [];
      for (const [index, file] of toUpload.entries()) {
        // canvas로 다시 그려 EXIF(촬영 위치 등)를 지운 JPEG만 올린다. 원본 파일명도 쓰지 않는다.
        const jpeg = await reencodeImageToJpeg(file, PRODUCT_IMAGE_ENCODE);
        const r = storageRef(storage, `products/${storeId}/${batchId}_${index}.jpg`);
        await uploadBytes(r, jpeg, { contentType: 'image/jpeg' });
        urls.push(await getDownloadURL(r));
      }
      onChange([...images, ...urls]);
    } catch (e) {
      onError(
        e instanceof ImageReencodeError
          ? imageReencodeFailureMessage(e.reason)
          : '이미지 업로드에 실패했습니다.',
      );
    } finally {
      setUploading(false);
    }
  }

  function remove(idx: number) {
    onChange(images.filter((_, i) => i !== idx));
  }

  function setAsMain(idx: number) {
    const reordered = [...images];
    reordered.unshift(reordered.splice(idx, 1)[0]);
    onChange(reordered);
  }

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Text
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--color-text-disabled)',
        }}
        mb="xs"
      >
        사진{' '}
        <Text component="span" style={{ color: 'var(--color-text-disabled)' }}>
          ({images.length}/5 · 첫 번째가 대표 사진)
        </Text>
      </Text>
      <Group gap="xs" style={{ overflowX: 'auto', paddingBottom: 4, flexWrap: 'nowrap' }}>
        {images.map((url, idx) => (
          <Box
            key={url}
            style={{
              position: 'relative',
              flexShrink: 0,
              width: 80,
              height: 80,
              borderRadius: 12,
              overflow: 'hidden',
              backgroundColor: 'var(--color-surface-muted)',
            }}
          >
            <Image fill src={url} alt="" sizes="80px" style={{ objectFit: 'cover' }} />
            {idx === 0 ? (
              <Box
                style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 4,
                  backgroundColor: 'var(--color-primary)',
                  color: 'white',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                대표
              </Box>
            ) : (
              <Box
                component="button"
                type="button"
                onClick={() => setAsMain(idx)}
                style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 4,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  color: 'white',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                대표 설정
              </Box>
            )}
            <Box
              style={{
                position: 'absolute',
                top: 4,
                left: 4,
                backgroundColor: 'rgba(0,0,0,0.5)',
                color: 'white',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 700,
                width: 16,
                height: 16,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {idx + 1}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={() => remove(idx)}
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 20,
                height: 20,
                backgroundColor: 'rgba(0,0,0,0.6)',
                color: 'white',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--font-size-xs)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ✕
            </Box>
          </Box>
        ))}
        {images.length < 5 && (
          <Box
            component="button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              flexShrink: 0,
              width: 80,
              height: 80,
              borderRadius: 12,
              border: '2px dashed var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-disabled)',
              backgroundColor: 'transparent',
              cursor: uploading ? 'not-allowed' : 'pointer',
            }}
          >
            {uploading ? (
              <Loader size="xs" color="var(--color-primary)" />
            ) : (
              <>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>사진 추가</span>
              </>
            )}
          </Box>
        )}
      </Group>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </Paper>
  );
}
