'use client';

import { Box, Button, Group, Paper, Select, Text } from '@mantine/core';
import { formatExpiryLong } from '../_lib';

const INVITE_EXPIRY_OPTIONS = [
  { value: '3', label: '3일' },
  { value: '7', label: '7일' },
  { value: '14', label: '14일' },
  { value: '30', label: '30일' },
];

interface InviteGeneratorProps {
  generating: boolean;
  lastToken: { token: string; expiresAt: string } | null;
  expiresInDays: string;
  copied: boolean;
  onExpiresInDaysChange: (value: string) => void;
  onGenerate: () => void;
  onCopy: () => void;
}

export function InviteGenerator({
  generating,
  lastToken,
  expiresInDays,
  copied,
  onExpiresInDaysChange,
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
        판매자 초대 토큰을 생성합니다. 토큰은 선택한 기간 동안 유효합니다.
      </Text>

      <Group align="end" gap="sm">
        <Select
          label="만료기간"
          aria-label="초대 만료기간"
          data={INVITE_EXPIRY_OPTIONS}
          value={expiresInDays}
          onChange={(value) => onExpiresInDaysChange(value ?? '7')}
          allowDeselect={false}
          w={140}
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
      </Group>

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
