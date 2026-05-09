import { Suspense } from 'react';
import { Container, Title, Stack } from '@mantine/core';
import { LoginForm } from './_form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const showCredentials = process.env.E2E_TEST === 'true';

  return (
    <Container size={400} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
      <Stack gap="lg" w="100%">
        <Title order={1} ta="center" style={{ color: 'var(--color-primary)' }}>
          Green Love
        </Title>
        <Suspense fallback={<div style={{ height: 240 }} />}>
          <LoginForm showCredentials={showCredentials} />
        </Suspense>
      </Stack>
    </Container>
  );
}
