'use client';

import { ActionIcon, Box, Button, Group, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { Plus, RotateCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
import type React from 'react';
import { useState } from 'react';
import type { AdminBanner, AdminBannerForm } from '@/hooks/useAdmin';
import { useAdminBanners } from '@/hooks/useAdmin';
import { getFirebaseStorage } from '@/lib/firebase';
import { BannerEditDrawer } from './_components/BannerEditDrawer';
import { BannerList } from './_components/BannerList';
import { bannerToForm, newScheduledBannerForm, validateBannerForm } from './_lib';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIZE_LABEL = '2MB';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function validateBannerImage(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return 'PNG, JPG, WebP 이미지만 업로드할 수 있습니다.';
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `이미지는 ${MAX_IMAGE_SIZE_LABEL} 이하로 업로드해주세요.`;
  }
  return null;
}

export default function AdminBannerClient() {
  const { data: session } = useSession();
  const { banners, loading, saving, reload, saveBanner, deleteBanner } = useAdminBanners();
  const [form, setForm] = useState<AdminBannerForm>(newScheduledBannerForm);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const openCreate = () => {
    setForm(newScheduledBannerForm());
    setFormError(null);
    setImageError(null);
    setDrawerOpen(true);
  };

  const openEdit = (banner: AdminBanner) => {
    setForm(bannerToForm(banner));
    setFormError(null);
    setImageError(null);
    setDrawerOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user) return;

    const validationMessage = validateBannerImage(file);
    setImageError(validationMessage);
    if (validationMessage) {
      notifications.show({ color: 'red', message: validationMessage });
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const folder = form.id ?? `draft_${Date.now()}`;
      const r = storageRef(getFirebaseStorage(), `banners/${folder}/${Date.now()}_${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setForm((current) => ({ ...current, imageUrl: url }));
      setImageError(null);
      notifications.show({ color: 'green', message: '배너 이미지를 업로드했습니다.' });
    } catch (error) {
      const message = getErrorMessage(error, '이미지 업로드 중 오류가 발생했습니다.');
      setImageError(message);
      notifications.show({ color: 'red', message });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    const validationMessage = validateBannerForm(form);
    setFormError(validationMessage);
    if (validationMessage) {
      notifications.show({ color: 'red', message: validationMessage });
      return;
    }

    const result = await saveBanner(form);
    if (result.ok) {
      notifications.show({ color: 'green', message: '배너를 저장했습니다.' });
      setDrawerOpen(false);
      return;
    }

    notifications.show({
      color: 'red',
      message: result.reason ?? '배너 저장 중 오류가 발생했습니다.',
    });
  };

  const handleDelete = async (banner: AdminBanner) => {
    if (!window.confirm('이 기간 배너를 삭제할까요? 업로드된 이미지도 함께 정리됩니다.')) return;
    setDeletingId(banner.id);
    const result = await deleteBanner(banner.id);
    setDeletingId(null);
    if (result.ok) {
      notifications.show({ color: 'green', message: '배너를 삭제했습니다.' });
      return;
    }
    notifications.show({
      color: 'red',
      message: result.reason ?? '배너 삭제 중 오류가 발생했습니다.',
    });
  };

  return (
    <Box>
      <Group justify="space-between" mb="md">
        <Title order={4}>
          히어로 배너 관리{' '}
          <Text
            component="span"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            ({banners.length})
          </Text>
        </Title>
        <Group gap="xs">
          <Tooltip label="새로고침">
            <ActionIcon
              aria-label="배너 목록 새로고침"
              color="gray"
              loading={loading}
              onClick={reload}
              radius="md"
              variant="subtle"
            >
              <RotateCw size={18} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<Plus size={16} />} onClick={openCreate} radius="md">
            새 배너
          </Button>
        </Group>
      </Group>

      <BannerList
        banners={banners}
        loading={loading}
        deletingId={deletingId}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      <BannerEditDrawer
        opened={drawerOpen}
        form={form}
        saving={saving}
        uploading={uploading}
        formError={formError}
        imageError={imageError}
        setForm={setForm}
        onClose={() => setDrawerOpen(false)}
        onSave={handleSave}
        onUpload={handleImageUpload}
      />
    </Box>
  );
}
