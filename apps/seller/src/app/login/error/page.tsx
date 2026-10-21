import { Box, Button, Container, Paper, Stack, Text, Title } from '@mantine/core';
import { describeSignInError } from '@/lib/seller-invite';

export const dynamic = 'force-dynamic';

// Auth.js 로그인 오류 화면(pages.error). 로그인 거절(AccessDenied)과 초대 가입 실패 사유를 한국어로 안내한다.
export default async function SignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const notice = describeSignInError(Array.isArray(error) ? error[0] : error);

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
          <Stack gap="md">
            <Title order={3}>{notice.title}</Title>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {notice.message}
            </Text>
            <Button component="a" href="/login" variant="outline" fullWidth radius="xl">
              로그인 화면으로
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
