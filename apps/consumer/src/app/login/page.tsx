import { Container, Stack, Text, Title } from '@mantine/core';
import { Suspense } from 'react';
import { LoginForm } from './_form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const showCredentials = process.env.E2E_TEST === 'true';

  return (
    <Container size={400} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
      <Stack gap="lg" w="100%">
        <Stack gap={4} align="center" mb="md">
          <Title
            order={1}
            ta="center"
            style={{
              fontFamily: 'var(--font-brand)',
              color: 'var(--color-primary-dark)',
              fontSize: 42,
              fontWeight: 800,
              letterSpacing: '-0.01em',
            }}
          >
            Green Love
          </Title>
          <Text
            style={{
              color: 'var(--color-primary-dark)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              letterSpacing: '0.04em',
            }}
          >
            그린러브
          </Text>
          <Text
            ta="center"
            mt="sm"
            style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
          >
            월요일 새벽 경매, 화요일 아침 문 앞 도착
          </Text>
        </Stack>
        <Suspense fallback={<div style={{ height: 240 }} />}>
          <LoginForm showCredentials={showCredentials} />
        </Suspense>
      </Stack>
    </Container>
  );
}
