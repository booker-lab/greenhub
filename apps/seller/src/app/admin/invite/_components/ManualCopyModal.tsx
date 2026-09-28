'use client';

import { Modal, Stack, Text, TextInput } from '@mantine/core';

interface ManualCopyModalProps {
  /** 자동 복사에 실패한 토큰. null이면 닫힘. */
  token: string | null;
  onClose: () => void;
}

// 클립보드 복사 실패 폴백 — 토큰을 선택된 상태로 보여 줘 사용자가 직접 복사(Ctrl+C·길게 누르기)하게 한다.
export function ManualCopyModal({ token, onClose }: ManualCopyModalProps) {
  return (
    <Modal
      opened={token !== null}
      onClose={onClose}
      title={<Text style={{ fontWeight: 'var(--fw-bold)' }}>토큰 직접 복사</Text>}
      radius="lg"
    >
      <Stack gap="sm">
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          자동 복사를 할 수 없어요. 아래 토큰을 선택해 복사해 주세요.
        </Text>
        <TextInput
          value={token ?? ''}
          readOnly
          data-autofocus
          aria-label="초대 토큰"
          radius="md"
          styles={{ input: { fontFamily: 'monospace', letterSpacing: '0.1em' } }}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
        />
      </Stack>
    </Modal>
  );
}
