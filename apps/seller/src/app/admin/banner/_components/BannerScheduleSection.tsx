'use client';

import { Paper, Stack, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import 'dayjs/locale/ko';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBannerForm } from '@/hooks/useAdmin';

interface BannerScheduleSectionProps {
  form: AdminBannerForm;
  setForm: Dispatch<SetStateAction<AdminBannerForm>>;
  error?: string | null;
}

export function BannerScheduleSection({ form, setForm, error }: BannerScheduleSectionProps) {
  if (form.kind === 'default') return null;

  return (
    <Paper radius="lg" shadow="xs" p="lg" style={{ border: '1px solid var(--color-border)' }}>
      <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }} mb="sm">
        노출 기간
      </Text>
      <Stack gap="sm">
        <DatePickerInput
          label="시작일"
          value={form.startDate || null}
          onChange={(value) => setForm((f) => ({ ...f, startDate: value ?? '' }))}
          valueFormat="YYYY-MM-DD"
          locale="ko"
          radius="md"
          error={error}
        />
        <DatePickerInput
          label="종료일"
          value={form.endDate || null}
          onChange={(value) => setForm((f) => ({ ...f, endDate: value ?? '' }))}
          valueFormat="YYYY-MM-DD"
          locale="ko"
          radius="md"
        />
      </Stack>
    </Paper>
  );
}
