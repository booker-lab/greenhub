'use client';

import { Button, Divider, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export function LoginForm({ showCredentials }: { showCredentials: boolean }) {
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
    <Stack gap="md">
      <Button
        type="button"
        onClick={() => signIn('kakao', { callbackUrl: '/orders' })}
        fullWidth
        size="md"
        radius="xl"
        style={{ backgroundColor: '#FEE500', color: '#191919' }}
        leftSection={
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="#191919"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 3C6.477 3 2 6.477 2 10.5c0 2.59 1.524 4.868 3.842 6.26L4.5 21l4.574-2.437A11.6 11.6 0 0 0 12 18.75c5.523 0 10-3.477 10-7.5S17.523 3 12 3z" />
          </svg>
        }
      >
        카카오로 시작하기
      </Button>

      {showCredentials && (
        <>
          <Divider label="또는" labelPosition="center" />

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
        </>
      )}
    </Stack>
  );
}
