'use client';

import { Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminBanner } from '@/hooks/useAdmin';

interface BannerCtaSectionProps {
  form: AdminBanner;
  setForm: Dispatch<SetStateAction<AdminBanner>>;
}

export function BannerCtaSection({ form, setForm }: BannerCtaSectionProps) {
  return (
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
              // biome-ignore lint/style/noNonNullAssertion: cta1 undefined 시 spread는 빈 객체로 안전하게 처리됨
              setForm((f) => ({ ...f, cta1: { ...f.cta1!, label: e.target.value } }))
            }
          />
          <TextInput
            label="버튼1 링크"
            placeholder="/products"
            value={form.cta1?.href ?? ''}
            onChange={(e) =>
              // biome-ignore lint/style/noNonNullAssertion: cta1 undefined 시 spread는 빈 객체로 안전하게 처리됨
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
              // biome-ignore lint/style/noNonNullAssertion: cta2 undefined 시 spread는 빈 객체로 안전하게 처리됨
              setForm((f) => ({ ...f, cta2: { ...f.cta2!, label: e.target.value } }))
            }
          />
          <TextInput
            label="버튼2 링크"
            placeholder="/groupbuy"
            value={form.cta2?.href ?? ''}
            onChange={(e) =>
              // biome-ignore lint/style/noNonNullAssertion: cta2 undefined 시 spread는 빈 객체로 안전하게 처리됨
              setForm((f) => ({ ...f, cta2: { ...f.cta2!, href: e.target.value } }))
            }
          />
        </Group>
      </Stack>
    </Paper>
  );
}
