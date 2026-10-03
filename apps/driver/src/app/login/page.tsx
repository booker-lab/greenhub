import Image from 'next/image';
import { signIn } from '@/auth';
import { Box, Divider, PasswordInput, Stack, Button, Text, TextInput, Title, Alert, Paper } from '@mantine/core';
import { resolveDriverLoginNotice } from './login-notice';

async function localCredentialSignIn(formData: FormData) {
  'use server';
  await signIn('credentials', {
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: '/board',
  });
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string | string[]; error?: string | string[] }>;
}) {
  const { pending, error } = await searchParams;
  const notice = resolveDriverLoginNotice({ pending, error });
  // Local pilot runtime에서만 승인된 드라이버의 Credentials 진입을 노출한다.
  // 운영/Preview에서는 카카오 로그인만 사용한다.
  const showLocalCredentials =
    process.env.GREENHUB_LOCAL_RUNTIME === 'true' && process.env.NODE_ENV !== 'production';

  return (
    <Box
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-bg)',
        padding: '0 16px',
      }}
    >
      <Box w="100%" style={{ maxWidth: 400 }}>
        <Paper radius="lg" p="xl" style={{ border: 'var(--border)' }}>
          {/* 로고 */}
          <Stack align="center" gap="xs" mb="xl">
            <Image
              src="/icons/icon-192x192.png"
              alt="그린러브 기사 앱 아이콘"
              width={64}
              height={64}
              style={{ borderRadius: 16, display: 'block' }}
            />
            <Title
              order={2}
              style={{
                fontFamily: 'var(--font-brand)',
                fontSize: 26,
                fontWeight: 800,
                color: 'var(--color-primary-dark)',
              }}
            >
              Green Love 드라이버
            </Title>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              드라이버 계정으로 로그인하세요
            </Text>
          </Stack>

          {/* 승인 대기·로그인 거절·관리자 계정·로그인 실패 안내 */}
          {notice && (
            <Alert color={notice.kind === 'failed' ? 'red' : 'yellow'} radius="md" mb="md">
              <Text
                style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
                mb={4}
              >
                {notice.title}
              </Text>
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>{notice.body}</Text>
            </Alert>
          )}

          {/* 카카오 로그인 */}
          <form
            action={async () => {
              'use server';
              await signIn('kakao', { redirectTo: '/board' });
            }}
          >
            <Button
              type="submit"
              fullWidth
              size="md"
              radius="xl"
              style={{ backgroundColor: '#FEE500', color: '#191919' }}
              leftSection={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919" aria-hidden="true" focusable="false">
                  <path d="M12 3C6.477 3 2 6.477 2 10.9c0 2.776 1.548 5.217 3.906 6.72l-.994 3.71a.25.25 0 00.375.274L9.43 19.28A11.6 11.6 0 0012 19.8c5.523 0 10-3.477 10-7.9S17.523 3 12 3z" />
                </svg>
              }
            >
              카카오로 시작하기
            </Button>
          </form>

          {/* 로컬 파일럿 전용: 승인된 드라이버 Credentials 진입 */}
          {showLocalCredentials && (
            <form action={localCredentialSignIn}>
              <Stack gap="sm" mt="md">
                <Divider label="또는 로컬 계정" labelPosition="center" />
                <TextInput
                  type="email"
                  name="email"
                  placeholder="이메일"
                  required
                  radius="xl"
                  size="md"
                />
                <PasswordInput
                  name="password"
                  placeholder="비밀번호"
                  required
                  radius="xl"
                  size="md"
                />
                <Button
                  type="submit"
                  fullWidth
                  size="md"
                  radius="xl"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  로그인
                </Button>
              </Stack>
            </form>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
