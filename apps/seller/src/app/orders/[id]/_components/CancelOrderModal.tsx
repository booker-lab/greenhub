'use client';

import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';

interface CancelOrderModalProps {
  opened: boolean;
  cancelReason: string;
  setCancelReason: (v: string) => void;
  actionLoading: boolean;
  actionError: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function CancelOrderModal({
  opened,
  cancelReason,
  setCancelReason,
  actionLoading,
  actionError,
  onClose,
  onConfirm,
}: CancelOrderModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text style={{ fontWeight: 'var(--fw-bold)' }}>강제 취소</Text>}
      radius="lg"
    >
      <Stack gap="sm">
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          취소 사유를 입력하세요. 소비자에게 알림톡으로 전달됩니다.
        </Text>
        <Textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="취소 사유 입력 (최소 5자)"
          rows={3}
          radius="md"
        />
        {cancelReason.length > 0 && cancelReason.trim().length < 5 && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
            최소 5자 이상 입력해주세요
          </Text>
        )}
        {actionError && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}>
            {actionError}
          </Text>
        )}
        <Group gap="xs">
          <Button
            onClick={onConfirm}
            disabled={actionLoading || cancelReason.trim().length < 5}
            flex={1}
            color="red"
            radius="xl"
            style={{ fontWeight: 'var(--fw-medium)' }}
          >
            {actionLoading ? '처리 중...' : '취소 확정'}
          </Button>
          <Button onClick={onClose} flex={1} radius="xl" variant="outline" color="gray">
            닫기
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
