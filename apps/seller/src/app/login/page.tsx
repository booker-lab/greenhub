import { Box, Container, Paper, Stack, Text, Title } from '@mantine/core';
import Image from 'next/image';
import { LoginForm } from './_form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  // E2E 헤더 게이트 환경 또는 local pilot runtime에서만 Credentials form을 노출한다.
  // launcher는 local child에서 E2E_TEST를 제거하므로 local marker도 함께 확인한다.
  const showCredentials =
    process.env.E2E_TEST === 'true' ||
    (process.env.GREENHUB_LOCAL_RUNTIME === 'true' && process.env.NODE_ENV !== 'production');

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
          <Stack align="center" gap="xs" mb="xl">
            <Image
              src="/icons/icon-192x192.png"
              alt="그린러브 판매자 앱 아이콘"
              width={64}
              height={64}
              style={{ borderRadius: 16, display: 'block' }}
            />
            <Title
              order={2}
              style={{
                fontFamily: 'var(--font-brand)',
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: '-0.01em',
                color: 'var(--color-primary-dark)',
              }}
            >
              Green Love
            </Title>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              판매자 계정으로 로그인하세요
            </Text>
          </Stack>

          <LoginForm showCredentials={showCredentials} />
        </Paper>
      </Container>
    </Box>
  );
}
