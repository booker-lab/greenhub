'use client';

import type { SalesMode } from '@greenhub/shared';
import { Box, Container, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { type ReactNode, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { apiJson } from '@/lib/api';
import { getFirebaseAuth } from '@/lib/firebase';
import { operationSettingsFor } from './settings-links';

/** 설정 섹션 카드 — 작은 회색 라벨 헤더 + 행 목록. */
function SectionCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Paper radius="lg" shadow="xs" style={{ overflow: 'hidden' }}>
      <Box px="md" py="sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {label}
        </Text>
      </Box>
      {children}
    </Paper>
  );
}

/**
 * 로그아웃: 이 탭의 Firebase 로그인 상태를 먼저 지운 뒤 NextAuth 세션을 끝낸다.
 * API refresh token 폐기는 NextAuth signOut 이벤트(auth.ts)가 맡는다.
 */
async function handleLogout() {
  try {
    await firebaseSignOut(getFirebaseAuth());
  } catch {
    // Firebase 정리에 실패해도 로그아웃은 계속한다. 다음 화면의 useFirebaseAuth가 다시 정리한다.
  }
  await signOut({ callbackUrl: '/login' });
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
  const { data: session } = useSession();
  // 겸직 계정(어드민 + 자기 store 보유)만 관리자 콘솔 진입 노출 (#CL-52)
  const isDualRole = session?.user.role === 'admin' && !!session.user.storeId;
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  const [salesMode, setSalesMode] = useState<SalesMode>();

  // 회차 판매 가게에는 적용되지 않는 예전 방식 메뉴(배송비·배송 슬롯·거점)를 숨기려고 판매 방식을 확인한다.
  useEffect(() => {
    if (!storeId || !token) return;
    let cancelled = false;
    apiJson<{ salesMode?: SalesMode }>(`/stores/${storeId}/public-profile`, token)
      .then((profile) => {
        if (!cancelled) setSalesMode(profile.salesMode ?? 'legacy');
      })
      .catch(() => {
        // 조회 실패 시 메뉴 접근을 막지 않는다.
        if (!cancelled) setSalesMode('legacy');
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, token]);

  return (
    <PageShell>
      <PageHeader title="설정" sticky={false} />

      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          <SectionCard label="계정">
            <LinkRow href="/onboarding" label="사업자 프로필 수정" />
            <UnstyledButton onClick={() => void handleLogout()} style={rowStyle(true)}>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                로그아웃
              </Text>
            </UnstyledButton>
          </SectionCard>

          {isDualRole && (
            <SectionCard label="관리자">
              <LinkRow href="/admin/stores" label="관리자 콘솔로 이동" />
            </SectionCard>
          )}

          {operationSettingsFor(salesMode).map((section) => (
            <SectionCard key={section.label} label={section.label}>
              {section.links.map((link, index) => (
                <LinkRow key={link.href} {...link} borderTop={index > 0} />
              ))}
            </SectionCard>
          ))}

          <SectionCard label="정보">
            <Group justify="space-between" px="md" py="md">
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                앱 버전
              </Text>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                0.1.0
              </Text>
            </Group>
          </SectionCard>
        </Stack>
      </Container>
    </PageShell>
  );
}
