'use client';

import { Alert, Box, Button, Checkbox, Container, Group, List, Stack, Text } from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';
import {
  WITHDRAW_ERASED_ITEMS,
  WITHDRAW_FAILED_MESSAGE,
  WITHDRAW_KEPT_ITEMS,
  requestWithdrawal,
} from './_lib';

const sectionTitleStyle = {
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--color-text)',
} as const;

const bodyTextStyle = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-secondary)',
} as const;

export default function WithdrawClient() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'unauthenticated') {
    router.replace('/login');
    return null;
  }

  async function handleWithdraw() {
    const token = session?.user?.accessToken;
    if (!token) {
      setError(WITHDRAW_FAILED_MESSAGE);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await requestWithdrawal(getApiBaseUrl(), token);
    if (result.ok) {
      await signOut({ callbackUrl: '/' });
      return;
    }
    setError(result.message);
    setSubmitting(false);
  }

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      <Group gap="xs" mb="lg">
        <Button
          variant="transparent"
          style={{ color: 'var(--color-text)' }}
          pl={0}
          onClick={() => router.back()}
          aria-label="뒤로 가기"
        >
          <ChevronLeft size={20} />
        </Button>
        <Text
          component="h1"
          style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}
        >
          회원 탈퇴
        </Text>
      </Group>

      <Stack gap="lg">
        <Box>
          <Text mb="xs" style={sectionTitleStyle}>
            탈퇴하면 지워지는 정보
          </Text>
          <List spacing={4} style={bodyTextStyle}>
            {WITHDRAW_ERASED_ITEMS.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        </Box>

        <Box>
          <Text mb="xs" style={sectionTitleStyle}>
            탈퇴해도 남는 정보
          </Text>
          <List spacing={4} style={bodyTextStyle}>
            {WITHDRAW_KEPT_ITEMS.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        </Box>

        <Text style={bodyTextStyle}>
          진행 중인 주문(결제 대기·준비·배송 중, 취소나 재배송비 결제 진행 중)이 있으면 그 주문이
          끝난 뒤 탈퇴할 수 있습니다. 같은 카카오 계정으로 다시 가입하면 새 계정으로 시작합니다.
        </Text>

        <Checkbox
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
          label="위 내용을 확인했고 탈퇴합니다."
          data-testid="withdraw-confirm"
        />

        {error && (
          <Alert color="red" variant="light" data-testid="withdraw-error">
            <Text style={{ fontSize: 'var(--font-size-sm)' }}>{error}</Text>
          </Alert>
        )}

        <Button
          color="red"
          radius="xl"
          size="md"
          fullWidth
          disabled={!confirmed}
          loading={submitting}
          onClick={handleWithdraw}
          data-testid="withdraw-submit"
        >
          탈퇴하기
        </Button>
      </Stack>
    </Container>
  );
}
