'use client';

import { Box, Button, Group, Paper, Stack, Switch, Text, Title } from '@mantine/core';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { type AdminBanner, useAdminBanner } from '@/hooks/useAdmin';
import { getFirebaseStorage } from '@/lib/firebase';
import { BannerCtaSection } from './_components/BannerCtaSection';
import { BannerImageSection } from './_components/BannerImageSection';
import { BannerTextSection } from './_components/BannerTextSection';

export default function AdminBannerClient() {
  const { data: session } = useSession();
  // read failure는 error/reload로 소비한다 — banner null만으로 unset을 단정하지 않는다.
  const { banner, loading, saving, error, saveError, save, reload } = useAdminBanner();

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
  // Firebase image upload는 기존 계약을 재설계하지 않는다.
  // 다만 완전 silent 실패는 복구 불가이므로 동일 UI 안에서 최소 오류 표면만 제공한다.
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 서버 상태 hydrate는 banner 갱신(초기 로드·저장 후 reload) 시에만 1회 반영한다.
  // form을 deps에 넣으면 편집 입력이 서버 값으로 매번 덮어쓰여 실패 후 입력 보존이 깨진다.
  const hydratedRef = useRef<AdminBanner | null>(null);
  useEffect(() => {
    if (banner && hydratedRef.current !== banner) {
      hydratedRef.current = banner;
      setForm((prev) => ({ ...prev, ...banner }));
    }
  }, [banner]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user) return;
    setUploading(true);
    setUploadError(null);
    try {
      const r = storageRef(getFirebaseStorage(), `banners/main_hero/${Date.now()}_${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setForm((f) => ({ ...f, imageUrl: url }));
    } catch {
      // 실패해도 기존 form 입력(imageUrl 포함)은 그대로 보존된다.
      setUploadError('이미지 업로드 중 오류 발생');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    // 이전 성공 표시가 실패 건에 잔류하지 않도록 먼저 내린다.
    setSaved(false);
    const ok = await save(form);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    // 실패 시 form은 그대로 보존되고 saveError 블록이 실패 feedback을 제공한다.
    // "저장 완료" 표시는 ok confirmed success에서만 설정된다.
  };

  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  // read failure 상태에서는 기본 빈 form을 authoritative current state처럼 편집/저장하게 하지 않는다.
  if (error !== null) {
    return (
      <Box>
        <Group justify="space-between" mb="md">
          <Title order={4}>히어로 배너 관리</Title>
        </Group>
        <Paper
          radius="lg"
          shadow="xs"
          style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
        >
          <Stack gap="sm" align="center" py={64} px="md">
            <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              배너 정보를 불러오지 못했습니다.
            </Text>
            <Text
              ta="center"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {error}
            </Text>
            <Button onClick={reload} size="sm" variant="outline" radius="md">
              다시 조회
            </Button>
          </Stack>
        </Paper>
      </Box>
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

      {banner === null && (
        <Text
          mb="md"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          현재 설정된 배너가 없습니다. 아래 양식으로 새 배너를 등록하세요.
        </Text>
      )}

      {saveError !== null && (
        <Paper
          radius="lg"
          shadow="xs"
          mb="md"
          p="md"
          style={{ border: '1px solid var(--color-danger)' }}
        >
          <Stack gap="xs" align="center">
            <Text style={{ fontWeight: 500, color: 'var(--color-danger)' }}>
              배너 저장에 실패했습니다.
            </Text>
            <Text
              ta="center"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {saveError} 입력 내용은 그대로 보존되어 있으니 다시 시도해 주세요.
            </Text>
            <Button onClick={handleSave} size="sm" variant="outline" radius="md" disabled={saving}>
              다시 저장
            </Button>
          </Stack>
        </Paper>
      )}

      {uploadError !== null && (
        <Text
          mb="md"
          ta="center"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {uploadError} 기존 이미지는 그대로 유지됩니다.
        </Text>
      )}

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
