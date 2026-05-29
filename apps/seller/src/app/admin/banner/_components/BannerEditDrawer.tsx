'use client';

import { Button, Drawer, SimpleGrid, Stack } from '@mantine/core';
import type React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBannerForm } from '@/hooks/useAdmin';
import { BannerCtaSection } from './BannerCtaSection';
import { BannerImageSection } from './BannerImageSection';
import { BannerLivePreview } from './BannerLivePreview';
import { BannerScheduleSection } from './BannerScheduleSection';
import { BannerTextSection } from './BannerTextSection';

interface BannerEditDrawerProps {
  opened: boolean;
  form: AdminBannerForm;
  saving: boolean;
  uploading: boolean;
  formError?: string | null;
  imageError?: string | null;
  setForm: Dispatch<SetStateAction<AdminBannerForm>>;
  onClose: () => void;
  onSave: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function BannerEditDrawer({
  opened,
  form,
  saving,
  uploading,
  formError,
  imageError,
  setForm,
  onClose,
  onSave,
  onUpload,
}: BannerEditDrawerProps) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={form.kind === 'default' ? '기본 배너 수정' : form.id ? '기간 배너 수정' : '새 배너'}
      position="right"
      size="xl"
      padding="lg"
    >
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Stack gap="md">
          <BannerImageSection
            imageUrl={form.imageUrl}
            uploading={uploading}
            onUpload={onUpload}
            error={imageError}
          />
          <BannerTextSection form={form} setForm={setForm} />
          <BannerScheduleSection form={form} setForm={setForm} error={formError} />
          <BannerCtaSection form={form} setForm={setForm} error={formError} />
          <Button onClick={onSave} loading={saving} disabled={uploading} radius="md">
            저장
          </Button>
        </Stack>
        <BannerLivePreview form={form} />
      </SimpleGrid>
    </Drawer>
  );
}
