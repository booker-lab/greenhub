'use client'

import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'
import {
  Box,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'

export default function SettingsPage() {
  const { data: session } = useSession()

  return (
    <Box component="main" style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface-muted)' }}>
      {/* 헤더 */}
      <Box
        component="header"
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          padding: '16px',
        }}
      >
        <Container size="sm">
          <Title order={3}>설정</Title>
        </Container>
      </Box>

      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          {/* 계정 섹션 */}
          <Paper radius="lg" shadow="xs" style={{ overflow: 'hidden' }}>
            <Box px="md" py="sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                계정
              </Text>
            </Box>
            <UnstyledButton
              component={Link}
              href="/onboarding"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', width: '100%' }}
            >
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>사업자 프로필 수정</Text>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </UnstyledButton>
            <UnstyledButton
              onClick={() => signOut({ callbackUrl: '/login' })}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                width: '100%',
                borderTop: '1px solid var(--color-border)',
              }}
            >
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>로그아웃</Text>
            </UnstyledButton>
          </Paper>

          {/* 배송 섹션 */}
          <Paper radius="lg" shadow="xs" style={{ overflow: 'hidden' }}>
            <Box px="md" py="sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                배송
              </Text>
            </Box>
            <UnstyledButton
              component={Link}
              href="/settings/delivery"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', width: '100%' }}
            >
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>배송비 설정 / 기상 제한</Text>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </UnstyledButton>
            <UnstyledButton
              component={Link}
              href="/settings/daily-caps"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                width: '100%',
                borderTop: '1px solid var(--color-border)',
              }}
            >
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>배송 슬롯 (Daily Cap)</Text>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </UnstyledButton>
          </Paper>

          {/* 정보 섹션 */}
          <Paper radius="lg" shadow="xs" style={{ overflow: 'hidden' }}>
            <Box px="md" py="sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Text style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--color-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                정보
              </Text>
            </Box>
            <Group justify="space-between" px="md" py="md">
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>앱 버전</Text>
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>0.1.0</Text>
            </Group>
          </Paper>
        </Stack>
      </Container>
    </Box>
  )
}
