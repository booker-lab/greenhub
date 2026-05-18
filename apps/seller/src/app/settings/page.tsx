'use client';

import { signOut } from 'next-auth/react';
import Link from 'next/link';
import { Box, Container, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';

/** 설정 섹션 카드 — 대문자 라벨 헤더 + 행 목록. */
function SectionCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Paper radius="lg" shadow="xs" style={{ overflow: 'hidden' }}>
      <Box px="md" py="sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--color-text-disabled)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {label}
        </Text>
      </Box>
      {children}
    </Paper>
  );
}

const rowStyle = (borderTop: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px',
  width: '100%',
  ...(borderTop ? { borderTop: '1px solid var(--color-border)' } : {}),
});

/** 다음 화면으로 이동하는 설정 행 (chevron 표기). */
function LinkRow({
  href,
  label,
  borderTop = false,
}: {
  href: string;
  label: string;
  borderTop?: boolean;
}) {
  return (
    <UnstyledButton component={Link} href={href} style={rowStyle(borderTop)}>
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>{label}</Text>
      <ChevronRight size={16} color="var(--color-text-disabled)" />
    </UnstyledButton>
  );
}

export default function SettingsPage() {
  return (
    <PageShell>
      <PageHeader title="설정" sticky={false} />

      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          <SectionCard label="계정">
            <LinkRow href="/onboarding" label="사업자 프로필 수정" />
            <UnstyledButton
              onClick={() => signOut({ callbackUrl: '/login' })}
              style={rowStyle(true)}
            >
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
                로그아웃
              </Text>
            </UnstyledButton>
          </SectionCard>

          <SectionCard label="배송">
            <LinkRow href="/settings/delivery" label="배송비 설정 / 기상 제한" />
            <LinkRow href="/settings/daily-caps" label="배송 슬롯 (Daily Cap)" borderTop />
          </SectionCard>

          <SectionCard label="거점">
            <LinkRow href="/hubs" label="거점 관리" />
          </SectionCard>

          <SectionCard label="정보">
            <Group justify="space-between" px="md" py="md">
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                앱 버전
              </Text>
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
                0.1.0
              </Text>
            </Group>
          </SectionCard>
        </Stack>
      </Container>
    </PageShell>
  );
}
