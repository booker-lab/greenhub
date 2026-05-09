import {
  Box,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { LoginForm } from './_form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const showCredentials = process.env.E2E_TEST === 'true';

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
            <Box
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundColor: 'var(--color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </Box>
            <Title order={2} style={{ fontSize: 'var(--font-size-xl)' }}>
              Green Love 판매자
            </Title>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              판매자 계정으로 로그인하세요
            </Text>
          </Stack>

          <LoginForm showCredentials={showCredentials} />
        </Paper>
      </Container>
    </Box>
  );
}
