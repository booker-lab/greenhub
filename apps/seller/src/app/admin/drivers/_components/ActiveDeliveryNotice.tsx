'use client';

import { Button, Modal, Stack, Text } from '@mantine/core';

interface ActiveDeliveryNoticeProps {
  /** 안내 문구. null이면 닫혀 있다. */
  message: string | null;
  onClose: () => void;
}

// 기사 정지 뒤 배송 중 배정 주문이 남아 있으면 확인창으로 알린다(정지는 이미 끝났다).
export function ActiveDeliveryNotice({ message, onClose }: ActiveDeliveryNoticeProps) {
  return (
    <Modal
      opened={message !== null}
      onClose={onClose}
      title={<Text style={{ fontWeight: 'var(--fw-bold)' }}>배송 중인 주문을 확인해 주세요</Text>}
      radius="lg"
      centered
    >
      <Stack gap="md">
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-line',
          }}
        >
          {message}
        </Text>
        <Button onClick={onClose} color="brand" radius="xl" fullWidth>
          확인
        </Button>
      </Stack>
    </Modal>
  );
}
