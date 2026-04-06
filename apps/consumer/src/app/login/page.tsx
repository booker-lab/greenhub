'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { Container, Title, TextInput, PasswordInput, Button, Text, Alert, Stack, Divider } from '@mantine/core'

function LoginForm() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      setLoading(false)
      return
    }

    window.location.href = callbackUrl
  }

  return (
    <Stack gap="sm">
      <Button
        fullWidth
        radius="md"
        size="md"
        style={{ backgroundColor: '#FEE500', color: '#000000' }}
        onClick={() => signIn('kakao', { callbackUrl })}
      >
        카카오로 시작하기
      </Button>

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
            radius="md"
          />
          <PasswordInput
            label="비밀번호"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호 입력"
            radius="md"
          />

          {error && (
            <Alert color="red" variant="light" p="sm">
              <Text size="sm">{error}</Text>
            </Alert>
          )}

          <Button
            type="submit"
            loading={loading}
            fullWidth
            color="brand"
            radius="md"
            mt="xs"
          >
            로그인
          </Button>
        </Stack>
      </form>
    </Stack>
  )
}

export default function LoginPage() {
  return (
    <Container size={400} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
      <Stack gap="lg" w="100%">
        <Title order={1} ta="center" c="brand.6">Green Hub</Title>
        <Suspense fallback={<div style={{ height: 240 }} />}>
          <LoginForm />
        </Suspense>
      </Stack>
    </Container>
  )
}
