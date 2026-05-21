'use client';

import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { type AdminDriver, type DriverStatus, useAdminDrivers } from '@/hooks/useAdmin';

type DriverAction = 'approve' | 'suspend' | 'unsuspend';

interface PendingAction {
  userId: string;
  action: DriverAction;
}

const ACTION_META: Record<
  DriverAction,
  { title: string; message: string; confirmLabel: string; confirmColor: string }
> = {
  approve: {
    title: '드라이버 승인',
    message: '이 드라이버를 승인하시겠습니까?',
    confirmLabel: '승인',
    confirmColor: 'green',
  },
  suspend: {
    title: '드라이버 정지',
    message: '이 드라이버를 정지하시겠습니까?',
    confirmLabel: '정지',
    confirmColor: 'red',
  },
  unsuspend: {
    title: '드라이버 정지 해제',
    message: '정지를 해제하시겠습니까?',
    confirmLabel: '해제',
    confirmColor: 'gray',
  },
};

const STATUS_TABS: { value: DriverStatus; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '승인 대기' },
  { value: 'approved', label: '승인 완료' },
  { value: 'suspended', label: '정지됨' },
];

function DriverBadge({ driver }: { driver: AdminDriver }) {
  if (driver.suspended)
    return (
      <Badge color="red" variant="light" radius="xl">
        정지됨
      </Badge>
    );
  if (driver.driverApproved)
    return (
      <Badge color="green" variant="light" radius="xl">
        승인 완료
      </Badge>
    );
  return (
    <Badge color="yellow" variant="light" radius="xl">
      승인 대기
    </Badge>
  );
}

export default function DriversClient() {
  const [tab, setTab] = useState<DriverStatus>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const { drivers: allDrivers, loading, approve, toggleSuspend } = useAdminDrivers();

  const drivers = useMemo(() => {
    if (tab === 'all') return allDrivers;
    if (tab === 'pending') return allDrivers.filter((d) => !d.driverApproved && !d.suspended);
    if (tab === 'approved') return allDrivers.filter((d) => d.driverApproved && !d.suspended);
    if (tab === 'suspended') return allDrivers.filter((d) => d.suspended);
    return allDrivers;
  }, [allDrivers, tab]);

  const runPending = async () => {
    if (!pending) return;
    setProcessingId(pending.userId);
    try {
      if (pending.action === 'approve') {
        await approve(pending.userId);
      } else {
        await toggleSuspend(pending.userId, pending.action === 'suspend');
      }
      setPending(null);
    } finally {
      setProcessingId(null);
    }
  };

  const pendingMeta = pending ? ACTION_META[pending.action] : null;

  return (
    <Box>
      <Title order={4} mb="md">
        드라이버 관리
      </Title>

      {/* 탭 */}
      <Box mb="md" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Group gap={4}>
          {STATUS_TABS.map((t) => (
            <UnstyledButton
              key={t.value}
              onClick={() => setTab(t.value)}
              style={{
                padding: '8px 16px',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 500,
                borderBottom: `2px solid ${tab === t.value ? 'var(--color-primary)' : 'transparent'}`,
                marginBottom: -1,
                color: tab === t.value ? 'var(--color-primary)' : 'var(--color-text-disabled)',
              }}
            >
              {t.label}
            </UnstyledButton>
          ))}
        </Group>
      </Box>

      {loading ? (
        <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
          불러오는 중...
        </Text>
      ) : drivers.length === 0 ? (
        <Text ta="center" py={80} style={{ color: 'var(--color-text-disabled)' }}>
          드라이버가 없습니다.
        </Text>
      ) : (
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
                      onClick={() => setPending({ userId: driver.id, action: 'approve' })}
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
                      onClick={() => setPending({ userId: driver.id, action: 'suspend' })}
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
                      onClick={() => setPending({ userId: driver.id, action: 'unsuspend' })}
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
      )}

      <ConfirmModal
        opened={pending !== null}
        title={pendingMeta?.title ?? ''}
        message={pendingMeta?.message ?? ''}
        confirmLabel={pendingMeta?.confirmLabel}
        confirmColor={pendingMeta?.confirmColor}
        loading={processingId !== null}
        onConfirm={runPending}
        onClose={() => {
          if (processingId === null) setPending(null);
        }}
      />
    </Box>
  );
}
