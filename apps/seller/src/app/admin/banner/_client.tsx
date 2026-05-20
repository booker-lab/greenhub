'use client';

import {
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { type AdminBanner, useAdminBanner } from '@/hooks/useAdmin';
import { getFirebaseStorage } from '@/lib/firebase';

export default function AdminBannerClient() {
  const { data: session } = useSession();
  const { banner, loading, saving, save } = useAdminBanner();

  const [form, setForm] = useState<AdminBanner>({
    imageUrl: '',
    tagText: '',
    headline: '',
    subText: '',
    cta1: { label: '', href: '' },
    cta2: { label: '', href: '' },
    isActive: true,
  });
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (banner) setForm({ ...form, ...banner });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner, form]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user) return;
    setUploading(true);
    try {
      const r = storageRef(getFirebaseStorage(), `banners/main_hero/${Date.now()}_${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setForm((f) => ({ ...f, imageUrl: url }));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    const ok = await save(form);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>히어로 배너 관리</Title>
        <Switch
          label="배너 활성화"
          checked={form.isActive ?? true}
          onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })}
        />
      </Group>

      <Stack gap="md">
        {/* 이미지 */}
        <Paper radius="lg" shadow="xs" p="lg" style={{ border: '1px solid var(--color-border)' }}>
          <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }} mb="sm">
            배경 이미지
          </Text>
          {form.imageUrl && (
            <Box
              mb="sm"
              style={{ borderRadius: 12, overflow: 'hidden', height: 180, position: 'relative' }}
            >
              <Image
                fill
                src={form.imageUrl}
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
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
              disabled={uploading}
            />
          </Box>
        </Paper>

        {/* 텍스트 */}
        <Paper radius="lg" shadow="xs" p="lg" style={{ border: '1px solid var(--color-border)' }}>
          <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }} mb="sm">
            텍스트
          </Text>
          <Stack gap="sm">
            <TextInput
              label="태그 문구"
              placeholder="예: 산지 직배송"
              value={form.tagText ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, tagText: e.target.value }))}
            />
            <Textarea
              label="헤드라인"
              placeholder="예: 오늘 수확한&#10;싱그러운 식물을&#10;집에서 만나보세요"
              autosize
              minRows={2}
              value={form.headline ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
            />
            <Textarea
              label="서브텍스트"
              placeholder="예: 시중가 대비 최대 30% 저렴하게"
              autosize
              minRows={2}
              value={form.subText ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, subText: e.target.value }))}
            />
          </Stack>
        </Paper>

        {/* CTA 버튼 */}
        <Paper radius="lg" shadow="xs" p="lg" style={{ border: '1px solid var(--color-border)' }}>
          <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }} mb="sm">
            버튼
          </Text>
          <Stack gap="sm">
            <Group grow>
              <TextInput
                label="버튼1 텍스트"
                placeholder="지금 인기상품 보기"
                value={form.cta1?.label ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cta1: { ...f.cta1!, label: e.target.value } }))
                }
              />
              <TextInput
                label="버튼1 링크"
                placeholder="/products"
                value={form.cta1?.href ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cta1: { ...f.cta1!, href: e.target.value } }))
                }
              />
            </Group>
            <Group grow>
              <TextInput
                label="버튼2 텍스트"
                placeholder="공구 참여하기"
                value={form.cta2?.label ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cta2: { ...f.cta2!, label: e.target.value } }))
                }
              />
              <TextInput
                label="버튼2 링크"
                placeholder="/groupbuy"
                value={form.cta2?.href ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cta2: { ...f.cta2!, href: e.target.value } }))
                }
              />
            </Group>
          </Stack>
        </Paper>

        <Button
          onClick={handleSave}
          disabled={saving}
          size="md"
          radius="xl"
          style={{ backgroundColor: saved ? 'var(--color-primary-light)' : 'var(--color-primary)' }}
        >
          {saving ? '저장 중...' : saved ? '저장 완료!' : '저장하기'}
        </Button>
      </Stack>
    </Box>
  );
}
