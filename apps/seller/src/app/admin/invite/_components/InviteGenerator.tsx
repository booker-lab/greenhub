'use client';

import { Box, Button, Group, Paper, Text } from '@mantine/core';
import { formatExpiryLong } from '../_lib';

interface InviteGeneratorProps {
  generating: boolean;
  lastToken: { token: string; expiresAt: string } | null;
  copied: boolean;
  onGenerate: () => void;
  onCopy: () => void;
}

export function InviteGenerator({
  generating,
  lastToken,
  copied,
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
