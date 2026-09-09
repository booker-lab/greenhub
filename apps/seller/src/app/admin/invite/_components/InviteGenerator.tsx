'use client';

import { Box, Button, Group, Paper, Text } from '@mantine/core';
import { formatExpiryLong } from '../_lib';

interface InviteGeneratorProps {
  generating: boolean;
  lastToken: { token: string; expiresAt: string } | null;
  copied: boolean;
  /** useAdminInvite 발급 command 실패 메시지. null이면 마지막 발급이 실패하지 않았음. */
  generateError: string | null;
  onGenerate: () => void;
  onCopy: () => void;
}

export function InviteGenerator({
  generating,
  lastToken,
  copied,
  generateError,
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
        판매자 초대 토큰을 생성합니다. 토큰은 발급 후 <strong>7일간</strong> 유효합니다.
      </Text>

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
              color: 'var(--color-error, #e03131)',
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
              color: 'var(--color-primary)',
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
            <Button onClick={onCopy} size="xs" variant="outline" color="green" radius="md">
              {copied ? '복사됨!' : '복사'}
            </Button>
          </Group>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }} mt="xs">
            만료: {formatExpiryLong(lastToken.expiresAt)}
          </Text>
        </Box>
      )}
    </Paper>
  );
}
