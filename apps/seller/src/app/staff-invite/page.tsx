'use client';

import { Box, Button, Container, Paper, Stack, Text, Title } from '@mantine/core';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Suspense, useMemo } from 'react';

function StaffInviteContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams]);

  const startKakao = () => {
    if (!token) return;
    // biome-ignore lint/suspicious/noDocumentCookie: OAuth 콜백에서 읽을 짧은 초대 토큰 쿠키를 설정한다.
    document.cookie = `hub_staff_invite_token=${encodeURIComponent(token)}; path=/; max-age=600; samesite=lax`;
    signIn('kakao', { callbackUrl: '/hubs' });
  };

  return (
    <Box
      component="main"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-bg)',
        padding: '0 16px',
      }}
    >
      <Container size="xs" w="100%">
        <Paper radius="lg" shadow="sm" p="xl">
          <Stack gap="lg">
            <Stack gap={6}>
              <Title order={2} style={{ fontSize: 'var(--font-size-xl)' }}>
                거점 스태프 초대
              </Title>
              <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                Kakao 계정으로 수락하면 해당 거점의 픽업 대기 주문을 확인할 수 있습니다.
              </Text>
            </Stack>

            {!token ? (
              <Text style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>
                초대 토큰이 없습니다. 판매자에게 새 초대 링크를 요청해 주세요.
              </Text>
            ) : (
              <Button
                type="button"
                onClick={startKakao}
                fullWidth
                size="md"
                radius="xl"
                style={{ backgroundColor: '#FEE500', color: '#191919' }}
              >
                Kakao로 초대 수락
              </Button>
            )}
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}

export default function StaffInvitePage() {
  return (
    <Suspense fallback={null}>
      <StaffInviteContent />
    </Suspense>
  );
}
