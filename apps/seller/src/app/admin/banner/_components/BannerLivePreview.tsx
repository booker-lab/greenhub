'use client';

import { Anchor, Badge, Box, Group, Paper, Stack, Text, Title } from '@mantine/core';
import Image from 'next/image';
import type { AdminBannerForm } from '@/hooks/useAdmin';

interface BannerLivePreviewProps {
  form: AdminBannerForm;
}

export function BannerLivePreview({ form }: BannerLivePreviewProps) {
  const ctas = [form.cta1, form.cta2].filter((cta) => cta?.label && cta.href);

  return (
    <Paper radius="lg" shadow="xs" p="lg" style={{ border: '1px solid var(--color-border)' }}>
      <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }} mb="sm">
        라이브 미리보기
      </Text>
      <Box
        style={{
          minHeight: 280,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 8,
          backgroundColor: 'var(--color-surface-muted)',
        }}
      >
        {form.imageUrl && (
          <Image
            fill
            src={form.imageUrl}
            alt="배너 라이브 미리보기"
            sizes="420px"
            style={{ objectFit: 'cover' }}
          />
        )}
        <Box
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.18))',
          }}
        />
        <Stack
          justify="flex-end"
          gap="sm"
          p="xl"
          style={{ position: 'absolute', inset: 0, color: 'white' }}
        >
          {form.tagText && (
            <Badge color="green" variant="filled" radius="xl">
              {form.tagText}
            </Badge>
          )}
          <Title order={2} style={{ fontSize: 28, lineHeight: 1.2, letterSpacing: 0 }}>
            {form.headline || '헤드라인을 입력하세요'}
          </Title>
          <Text style={{ maxWidth: 360, color: 'rgba(255,255,255,.86)' }}>
            {form.subText || '서브텍스트가 이 위치에 표시됩니다.'}
          </Text>
          {ctas.length > 0 && (
            <Group gap="xs">
              {ctas.map((cta) => (
                <Anchor
                  key={`${cta?.label}-${cta?.href}`}
                  href={cta?.href}
                  style={{
                    color: 'white',
                    border: '1px solid rgba(255,255,255,.72)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    textDecoration: 'none',
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  {cta?.label}
                </Anchor>
              ))}
            </Group>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}
