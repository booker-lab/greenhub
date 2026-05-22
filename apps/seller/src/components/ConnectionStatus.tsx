'use client';

import { Box, Group, Text } from '@mantine/core';

interface ConnectionStatusProps {
  loading: boolean;
  error?: string | null;
  /** Firebase Auth 준비 여부 (미지정 시 준비 완료로 간주). */
  firebaseReady?: boolean;
}

/** Firestore 실시간 구독 상태 dot + 텍스트. PageHeader right slot 공용. */
export function ConnectionStatus({ loading, error, firebaseReady = true }: ConnectionStatusProps) {
  const connecting = loading || !firebaseReady;
  const color = connecting
    ? 'var(--color-caution-border)'
    : error
      ? 'var(--color-danger)'
      : 'var(--color-primary)';
  const label = connecting ? '연결 중' : error ? '연결 오류' : '실시간 연결';

  return (
    <Group gap={6}>
      <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
      <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
        {label}
      </Text>
    </Group>
  );
}
