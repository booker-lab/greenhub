'use client';

import { Paper, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBanner, BannerCta } from '@/hooks/useAdmin';

interface BannerCtaSectionProps {
  form: AdminBanner;
  setForm: Dispatch<SetStateAction<AdminBanner>>;
  error?: string | null;
}

type CtaKey = 'cta1' | 'cta2';
type CtaField = keyof BannerCta;

function updateCta(
  setForm: Dispatch<SetStateAction<AdminBanner>>,
  key: CtaKey,
  field: CtaField,
  value: string,
) {
  setForm((form) => ({
    ...form,
    [key]: {
      label: form[key]?.label ?? '',
      href: form[key]?.href ?? '',
      [field]: value,
    },
  }));
}

export function BannerCtaSection({ form, setForm, error }: BannerCtaSectionProps) {
  return (
    <Paper radius="lg" shadow="xs" p="lg" style={{ border: '1px solid var(--color-border)' }}>
      <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }} mb="sm">
        버튼
      </Text>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput
            label="버튼1 문구"
            placeholder="지금 인기 상품 보기"
            value={form.cta1?.label ?? ''}
            error={error}
            onChange={(e) => updateCta(setForm, 'cta1', 'label', e.target.value)}
          />
          <TextInput
            label="버튼1 링크"
            placeholder="/products"
            value={form.cta1?.href ?? ''}
            onChange={(e) => updateCta(setForm, 'cta1', 'href', e.target.value)}
          />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput
            label="버튼2 문구"
            placeholder="공구 참여하기"
            value={form.cta2?.label ?? ''}
            error={error}
            onChange={(e) => updateCta(setForm, 'cta2', 'label', e.target.value)}
          />
          <TextInput
            label="버튼2 링크"
            placeholder="/groupbuy"
            value={form.cta2?.href ?? ''}
            onChange={(e) => updateCta(setForm, 'cta2', 'href', e.target.value)}
          />
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}
