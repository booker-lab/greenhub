'use client';

import { Box, Button, Group, Paper, Text, TextInput } from '@mantine/core';
import type { IssuedInvite } from '@/hooks/useAdmin';
import { formatExpiryLong, INVITE_RECIPIENT_EMAIL_MAX_LENGTH } from '../_lib';

interface InviteGeneratorProps {
  generating: boolean;
  lastToken: IssuedInvite | null;
  copied: boolean;
  /** useAdminInvite 발급 command 실패 메시지. null이면 마지막 발급이 실패하지 않았음. */
  generateError: string | null;
  /** 받는 사람 이메일 입력값(선택). 비우면 받는 사람 제한 없는 초대를 발급한다. */
  recipientEmail: string;
  /** 받는 사람 이메일 입력 오류. null이면 오류 없음. */
  recipientEmailError: string | null;
  onRecipientEmailChange: (value: string) => void;
  onGenerate: () => void;
  onCopy: () => void;
}

export function InviteGenerator({
  generating,
  lastToken,
  copied,
  generateError,
  recipientEmail,
  recipientEmailError,
  onRecipientEmailChange,
  onGenerate,
  onCopy,
}: InviteGeneratorProps) {
  return (
    <Paper
      radius="lg"
      shadow="xs"
      style={{ border: '1px solid var(--color-border)' }}
      p="lg"
      mb="xl"
    >
      <Text
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        mb="md"
      >
        판매자 초대 토큰을 생성합니다. 토큰은 발급 후 <strong>72시간</strong> 유효합니다.
      </Text>

      <TextInput
        type="email"
        label="받는 사람 이메일 (선택)"
        description="입력하면 이 이메일로만 가입할 수 있어요. 비우면 누구나 이 토큰으로 가입할 수 있어요."
        placeholder="seller@example.com"
        value={recipientEmail}
        onChange={(event) => onRecipientEmailChange(event.currentTarget.value)}
        error={recipientEmailError}
        maxLength={INVITE_RECIPIENT_EMAIL_MAX_LENGTH}
        disabled={generating}
        autoComplete="off"
        mb="md"
      />

      <Button
        onClick={onGenerate}
        disabled={generating}
        size="md"
        radius="xl"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {generating ? '생성중…' : '새 토큰 생성'}
      </Button>

      {/* 발급 command 실패는 성공과 구분해 사용자에게 알린다. 성공한 경우에만 lastToken이 갱신되므로 이 블록은 이전 성공 토큰을 덮어쓰지 않는다. */}
      {generateError !== null && (
        <Box
          mt="md"
          p="md"
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 12,
          }}
        >
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-danger)',
            }}
            mb={4}
          >
            토큰 발급에 실패했습니다.
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {generateError}
          </Text>
        </Box>
      )}

      {lastToken && (
        <Box
          mt="md"
          p="md"
          style={{
            backgroundColor: 'var(--color-primary-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
          }}
        >
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-primary-dark)',
              fontWeight: 'var(--fw-medium)',
            }}
            mb="xs"
          >
            생성된 초대 토큰
          </Text>
          <Group gap="sm">
            <Text
              component="code"
              ff="monospace"
              style={{
                flex: 1,
                letterSpacing: '0.15em',
                fontSize: 'var(--font-size-lg)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-primary-dark)',
              }}
            >
              {lastToken.token}
            </Text>
            <Button onClick={onCopy} size="xs" variant="outline" color="brand" radius="md">
              {copied ? '복사됨!' : '복사'}
            </Button>
          </Group>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-dark)' }}
            mt="xs"
          >
            만료: {formatExpiryLong(lastToken.expiresAt)}
          </Text>
          {lastToken.recipientEmail && (
            <Text
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-dark)' }}
              mt={4}
            >
              받는 사람: {lastToken.recipientEmail}
            </Text>
          )}
        </Box>
      )}
    </Paper>
  );
}
