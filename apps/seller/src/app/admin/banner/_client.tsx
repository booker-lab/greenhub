'use client';

import { Box, Button, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { type AdminBanner, useAdminBanner } from '@/hooks/useAdmin';
import { getFirebaseStorage } from '@/lib/firebase';
import { BannerCtaSection } from './_components/BannerCtaSection';
import { BannerImageSection } from './_components/BannerImageSection';
import { BannerTextSection } from './_components/BannerTextSection';

const DEFAULT_BANNER_FORM: AdminBanner = {
  imageUrl: '',
  tagText: '',
  headline: '',
  subText: '',
  cta1: { label: '', href: '' },
  cta2: { label: '', href: '' },
  isActive: true,
};

function hasPartialCta(cta?: { label?: string; href?: string }) {
  const hasLabel = Boolean(cta?.label?.trim());
  const hasHref = Boolean(cta?.href?.trim());
  return hasLabel !== hasHref;
}

function validateCta(form: AdminBanner): string | null {
  if (hasPartialCta(form.cta1) || hasPartialCta(form.cta2)) {
    return '버튼 문구와 URL은 둘 다 입력하거나 둘 다 비워주세요.';
  }
  return null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function AdminBannerClient() {
  const { data: session } = useSession();
  const { banner, loading, saving, save } = useAdminBanner();

  const [form, setForm] = useState<AdminBanner>(DEFAULT_BANNER_FORM);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);

  useEffect(() => {
    if (banner) setForm({ ...DEFAULT_BANNER_FORM, ...banner });
  }, [banner]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user) return;
    setUploading(true);
    try {
      const r = storageRef(getFirebaseStorage(), `banners/main_hero/${Date.now()}_${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setForm((f) => ({ ...f, imageUrl: url }));
      notifications.show({ color: 'green', message: '배너 이미지를 업로드했습니다.' });
    } catch (error) {
      notifications.show({
        color: 'red',
        message: getErrorMessage(error, '이미지 업로드 중 오류가 발생했습니다.'),
      });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    const validationMessage = validateCta(form);
    setCtaError(validationMessage);
    if (validationMessage) {
      notifications.show({ color: 'red', message: validationMessage });
      return;
    }

    const result = await save(form);
    if (result.ok) {
      setSaved(true);
      notifications.show({ color: 'green', message: '배너를 저장했습니다.' });
      setTimeout(() => setSaved(false), 2000);
      return;
    }

    notifications.show({
      color: 'red',
      message: result.reason ?? '배너 저장 중 오류가 발생했습니다.',
    });
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
        <BannerImageSection
          imageUrl={form.imageUrl}
          uploading={uploading}
          onUpload={handleImageUpload}
        />
        <BannerTextSection form={form} setForm={setForm} />
        <BannerCtaSection form={form} setForm={setForm} error={ctaError} />

        <Button
          onClick={handleSave}
          disabled={saving || uploading}
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
