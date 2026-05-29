'use client';

import { Box, Group, Title, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { type DriverStatus, useAdminDrivers } from '@/hooks/useAdmin';
import { DriverList } from './_components/DriverList';
import { ACTION_META, type DriverAction, type PendingAction, STATUS_TABS } from './_lib';

export default function DriversClient() {
  const [tab, setTab] = useState<DriverStatus>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const { drivers, loading, approve, toggleSuspend } = useAdminDrivers({ status: tab });

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

  const handleAction = (userId: string, action: DriverAction) => setPending({ userId, action });

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

      <DriverList
        drivers={drivers}
        loading={loading}
        processingId={processingId}
        onAction={handleAction}
      />

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
