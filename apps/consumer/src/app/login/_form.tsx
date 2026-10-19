'use client';

import { Alert, Button, Divider, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isFeatureOn } from '@/lib/features';
import { isOrderCallback, safeCallbackPath } from './_callback-url';

export function LoginForm({ showCredentials }: { showCredentials: boolean }) {
  const searchParams = useSearchParams();
  const rawCallbackUrl = searchParams.get('callbackUrl');
  // 같은 출처 상대 경로만 복귀 주소로 쓴다(열린 리다이렉트 방지). 출처 비교에 window가
  // 필요하므로 서버 렌더가 아닌 클릭 시점에 계산한다.
  const resolveCallbackUrl = () => safeCallbackPath(rawCallbackUrl, window.location.origin);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      setLoading(false);
      return;
    }

    window.location.href = resolveCallbackUrl();
  };

  // 비회원 장바구니(guest-cart): 주문하러 온 손님에게 왜 로그인하는지 알려 준다.
  // 복귀 주소가 같은 출처 절대 주소로 오는 경우도 판정하려면 출처가 필요해, 마운트 뒤에 채운다.
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);
  const forOrder = isFeatureOn('guest-cart') && isOrderCallback(rawCallbackUrl, origin);

  return (
    <Stack gap="sm">
      {forOrder && (
        <Text
          role="status"
          ta="center"
          style={{
            background: 'var(--color-primary-surface)',
            borderRadius: 'var(--radius)',
            color: 'var(--color-primary-dark)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            padding: '12px 16px',
          }}
        >
          주문하려면 로그인이 필요해요. 장바구니는 그대로 남아 있어요.
        </Text>
      )}
      <Button
        fullWidth
        radius="xl"
        size="lg"
        style={{ backgroundColor: '#FEE500', color: '#000000' }}
        onClick={() => signIn('kakao', { callbackUrl: resolveCallbackUrl() })}
      >
        카카오로 시작하기
      </Button>

      {showCredentials && (
        <>
          <Divider label="또는" labelPosition="center" />

          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <TextInput
                label="이메일"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
              />
              <PasswordInput
                label="비밀번호"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
              />

              {error && (
                <Alert color="red" variant="light" p="sm">
                  <Text style={{ fontSize: 'var(--font-size-sm)' }}>{error}</Text>
                </Alert>
              )}

              <Button type="submit" loading={loading} fullWidth color="brand" size="lg" mt="xs">
                로그인
              </Button>
            </Stack>
          </form>
        </>
      )}
      {isFeatureOn('guest-cart') && (
        <Link
          href="/"
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--font-size-sm)',
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          로그인 없이 더 둘러보기
        </Link>
      )}
    </Stack>
  );
}
