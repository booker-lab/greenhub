'use client';

import { Box, Button, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { type AdminBanner, useAdminBanner } from '@/hooks/useAdmin';
import { getFirebaseStorage } from '@/lib/firebase';
import { BannerCtaSection } from './_components/BannerCtaSection';
import { BannerImageSection } from './_components/BannerImageSection';
import { BannerTextSection } from './_components/BannerTextSection';

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
        <BannerImageSection
          imageUrl={form.imageUrl}
          uploading={uploading}
          onUpload={handleImageUpload}
        />
        <BannerTextSection form={form} setForm={setForm} />
        <BannerCtaSection form={form} setForm={setForm} />

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
