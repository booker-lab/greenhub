'use client';

import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

interface ConfirmModalProps {
  opened: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmModal({
  opened,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  confirmColor = 'red',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text style={{ fontWeight: 'var(--fw-bold)' }}>{title}</Text>}
      radius="lg"
      centered
    >
      <Stack gap="md">
        {typeof message === 'string' ? (
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-line',
            }}
          >
            {message}
          </Text>
        ) : (
          message
        )}
        <Group gap="xs">
          <Button
            onClick={onConfirm}
            disabled={loading}
            flex={1}
            color={confirmColor}
            radius="xl"
            style={{ fontWeight: 'var(--fw-medium)' }}
          >
            {loading ? '처리 중...' : confirmLabel}
          </Button>
          <Button
            onClick={onClose}
            disabled={loading}
            flex={1}
            radius="xl"
            variant="outline"
            color="gray"
          >
            {cancelLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
