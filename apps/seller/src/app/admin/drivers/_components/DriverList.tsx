'use client';

import { Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import type { AdminDriver } from '@/hooks/useAdmin';
import { ACTION_META, type DriverAction, formatDriverCreatedAt, getDriverActions } from '../_lib';
import { DriverBadge } from './DriverBadge';

interface DriverListProps {
  drivers: AdminDriver[];
  loading: boolean;
  processingId: string | null;
  emptyMessage?: string;
  onAction: (userId: string, action: DriverAction) => void;
}

export function DriverList({
  drivers,
  loading,
  processingId,
  emptyMessage,
  onAction,
}: DriverListProps) {
  if (loading) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </Text>
    );
  }

  if (drivers.length === 0) {
    return (
      <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
        {emptyMessage ?? '드라이버가 없습니다.'}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {drivers.map((driver) => {
        const actions = getDriverActions(driver);

        return (
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
                <Text
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}
                >
                  가입일 {formatDriverCreatedAt(driver.createdAt)}
                </Text>
              </Box>

              <Group gap="xs" style={{ flexShrink: 0 }}>
                {actions.map((action) => {
                  const meta = ACTION_META[action];
                  return (
                    <Button
                      key={action}
                      onClick={() => onAction(driver.id, action)}
                      disabled={processingId === driver.id}
                      size="xs"
                      variant={meta.buttonVariant}
                      color={meta.buttonColor}
                      radius="md"
                    >
                      {processingId === driver.id ? '처리중…' : meta.buttonLabel}
                    </Button>
                  );
                })}
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
