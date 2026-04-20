'use client'

import { useRef, useState } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { Badge, Box, Group, Loader, Paper, Stack, Text } from '@mantine/core'

interface ImageUploadProps {
  storeId: string
  images: string[]
  onChange: (images: string[]) => void
  onError: (msg: string) => void
}

export default function ImageUpload({ storeId, images, onChange, onError }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  const MAX_SIZE = 5 * 1024 * 1024 // 5MB

  async function handleFiles(files: FileList | null) {
    if (!files || images.length >= 5) return
    const toUpload = Array.from(files).slice(0, 5 - images.length)

    for (const file of toUpload) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        onError('JPG, PNG, WebP, GIF 파일만 업로드 가능합니다.')
        return
      }
      if (file.size > MAX_SIZE) {
        onError('파일 크기는 5MB 이하만 가능합니다.')
        return
      }
    }

    setUploading(true)
    try {
      const urls = await Promise.all(
        toUpload.map(async (file) => {
          const r = storageRef(storage, `products/${storeId}/${Date.now()}_${file.name}`)
          await uploadBytes(r, file)
          return getDownloadURL(r)
        }),
      )
      onChange([...images, ...urls])
    } catch {
      onError('이미지 업로드에 실패했습니다.')
    } finally {
      setUploading(false)
    }
  }

  function remove(idx: number) {
    onChange(images.filter((_, i) => i !== idx))
  }

  function setAsMain(idx: number) {
    const reordered = [...images]
    reordered.unshift(reordered.splice(idx, 1)[0])
    onChange(reordered)
  }

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Text size="xs" fw={500} c="dimmed" mb="xs">
        사진 <Text component="span" c="gray.4">({images.length}/5 · 첫 번째가 대표 사진)</Text>
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
              backgroundColor: 'var(--mantine-color-gray-1)',
            }}
          >
            <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {idx === 0 ? (
              <Box
                style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 4,
                  backgroundColor: 'var(--green-primary)',
                  color: 'white',
                  fontSize: 9,
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
                  fontSize: 9,
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
                fontSize: 9,
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
                fontSize: 11,
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
              border: '2px dashed var(--mantine-color-gray-3)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 12,
              color: 'var(--mantine-color-gray-5)',
              backgroundColor: 'transparent',
              cursor: uploading ? 'not-allowed' : 'pointer',
            }}
          >
            {uploading ? (
              <Loader size="xs" color="var(--green-primary)" />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
      />
    </Paper>
  )
}
