'use client';

import { Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminDriver } from '@/hooks/useAdmin';
import { type AdminDriversReadState, type DriverAction, getAdminDriversReadState } from '../_lib';
import { DriverBadge } from './DriverBadge';

interface DriverListProps {
  drivers: AdminDriver[];
  loading: boolean;
  /** useAdminDrivers 조회 실패 메시지. null이면 마지막 조회가 실패하지 않았음. */
  error: string | null;
  processingId: string | null;
  onAction: (userId: string, action: DriverAction) => void;
  /** 조회 실패 시 재시도 — hook의 reload()에 연결된다. 현재 탭을 유지한다. */
  onRetry: () => void;
}

export function DriverList({
  drivers,
  loading,
  error,
  processingId,
  onAction,
  onRetry,
}: DriverListProps) {
  const readState: AdminDriversReadState = getAdminDriversReadState({ loading, error, drivers });

  if (readState === 'LOADING') {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  // 조회 실패는 성공-empty와 구조적으로 구분 — "드라이버가 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <Stack gap="sm" align="center" py={64} px="md">
        <Text style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
          드라이버 목록을 불러오지 못했습니다.
        </Text>
        <Text
          ta="center"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {error}
        </Text>
        <Button onClick={onRetry} size="sm" variant="outline" radius="md">
          다시 조회
        </Button>
      </Stack>
    );
  }

  if (readState === 'EMPTY') {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        드라이버가 없습니다.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {drivers.map((driver) => (
        <Paper
          key={driver.id}
          radius="lg"
          px="md"
          py="sm"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <Group justify="space-between" gap="md">
            <Box style={{ minWidth: 0 }}>
              <Group gap="xs" mb={2}>
                <Text
                  style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--font-size-sm)' }}
                  truncate
                >
                  {driver.name}
                </Text>
                <DriverBadge driver={driver} />
              </Group>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                truncate
              >
                {driver.email ?? '이메일 없음'}
              </Text>
            </Box>

            <Group gap="xs" style={{ flexShrink: 0 }}>
              {!driver.driverApproved && !driver.suspended && (
                <Button
                  onClick={() => onAction(driver.id, 'approve')}
                  disabled={processingId === driver.id}
                  size="xs"
                  color="green"
                  radius="md"
                >
                  {processingId === driver.id ? '처리중…' : '승인'}
                </Button>
              )}
              {!driver.suspended ? (
                <Button
                  onClick={() => onAction(driver.id, 'suspend')}
                  disabled={processingId === driver.id}
                  size="xs"
                  variant="light"
                  color="red"
                  radius="md"
                >
                  정지
                </Button>
              ) : (
                <Button
                  onClick={() => onAction(driver.id, 'unsuspend')}
                  disabled={processingId === driver.id}
                  size="xs"
                  variant="light"
                  color="gray"
                  radius="md"
                >
                  정지 해제
                </Button>
              )}
            </Group>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
