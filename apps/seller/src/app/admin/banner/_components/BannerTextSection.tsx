'use client';

import { Paper, Stack, Text, Textarea, TextInput } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBannerForm } from '@/hooks/useAdmin';

interface BannerTextSectionProps {
  form: AdminBannerForm;
  setForm: Dispatch<SetStateAction<AdminBannerForm>>;
}

export function BannerTextSection({ form, setForm }: BannerTextSectionProps) {
  return (
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
  );
}
