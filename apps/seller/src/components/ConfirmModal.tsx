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
  /** 확인 버튼만 잠근다(필수 입력 전 등). 처리 중 표시는 loading이 담당한다. */
  confirmDisabled?: boolean;
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
  confirmDisabled = false,
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
            disabled={loading || confirmDisabled}
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
