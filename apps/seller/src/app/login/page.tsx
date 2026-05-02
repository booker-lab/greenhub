'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Button,
  Container,
  Divider,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  PasswordInput,
} from '@mantine/core';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      return;
    }

    router.push('/orders');
  }

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
          {/* 로고 */}
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

          <Stack gap="md">
            {/* 카카오 로그인 */}
            <Button
              type="button"
              onClick={() => signIn('kakao', { callbackUrl: '/orders' })}
              fullWidth
              size="md"
              radius="xl"
              style={{
                backgroundColor: '#FEE500',
                color: '#191919',
              }}
              leftSection={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919" aria-hidden="true" focusable="false">
                  <path d="M12 3C6.477 3 2 6.477 2 10.5c0 2.59 1.524 4.868 3.842 6.26L4.5 21l4.574-2.437A11.6 11.6 0 0 0 12 18.75c5.523 0 10-3.477 10-7.5S17.523 3 12 3z" />
                </svg>
              }
            >
              카카오로 시작하기
            </Button>

            <Divider label="또는" labelPosition="center" />

            {/* 이메일 로그인 */}
            <form onSubmit={handleSubmit}>
              <Stack gap="sm">
                <TextInput
                  type="email"
                  placeholder="이메일"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  radius="xl"
                  size="md"
                />
                <PasswordInput
                  placeholder="비밀번호"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  radius="xl"
                  size="md"
                />
                {error && (
                  <Text
                    style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                    ta="center"
                  >
                    {error}
                  </Text>
                )}
                <Button
                  type="submit"
                  disabled={loading}
                  fullWidth
                  size="md"
                  radius="xl"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {loading ? '로그인 중...' : '로그인'}
                </Button>
              </Stack>
            </form>

            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              ta="center"
            >
              계정이 없으신가요? 관리자에게 문의하세요.
            </Text>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
