'use client';

import { Box, Button, Group, Paper, Text, TextInput } from '@mantine/core';
import type { IssuedInvite } from '@/hooks/useAdmin';
import { formatKstDateTime, INVITE_RECIPIENT_EMAIL_MAX_LENGTH } from '../_lib';

interface InviteGeneratorProps {
  generating: boolean;
  lastToken: IssuedInvite | null;
  /** 발급 직후 초대의 링크(/invite/[token]). lastToken이 있을 때만 값이 있다. */
  lastLink: string | null;
  copied: boolean;
  /** useAdminInvite 발급 command 실패 메시지. null이면 마지막 발급이 실패하지 않았음. */
  generateError: string | null;
  /** 받는 사람 이메일 입력값(필수). 비어 있으면 생성 버튼을 막는다. */
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
  lastLink,
  copied,
  generateError,
  recipientEmail,
  recipientEmailError,
  onRecipientEmailChange,
  onGenerate,
  onCopy,
}: InviteGeneratorProps) {
  // 받는 사람 이메일은 필수다. 비어 있으면 생성 버튼을 막고, 형식 오류는 누른 뒤 입력란에 보여 준다.
  const recipientMissing = recipientEmail.trim() === '';

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
        판매자 초대 링크를 만듭니다. 링크는 발급 후 <strong>72시간</strong> 동안 한 번만 쓸 수 있고,
        받는 분이 링크를 열어 카카오로 로그인하면 판매자로 가입돼요.
      </Text>

      <TextInput
        type="email"
        label="받는 사람 이메일"
        description="카카오 계정 이메일이 있으면 이 이메일과 같아야 가입할 수 있어요."
        required
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
        disabled={generating || recipientMissing}
        size="md"
        radius="xl"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {generating ? '만드는 중…' : '새 초대 링크 만들기'}
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
            초대 링크 발급에 실패했습니다.
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
            생성된 초대 링크
          </Text>
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <Text
              component="code"
              ff="monospace"
              style={{
                flex: 1,
                minWidth: 0,
                wordBreak: 'break-all',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-primary-dark)',
              }}
            >
              {lastLink ?? lastToken.token}
            </Text>
            <Button onClick={onCopy} size="xs" variant="outline" color="brand" radius="md">
              {copied ? '복사됨!' : '링크 복사'}
            </Button>
          </Group>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-dark)' }}
            mt="xs"
          >
            만료: {formatKstDateTime(lastToken.expiresAt)}
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
