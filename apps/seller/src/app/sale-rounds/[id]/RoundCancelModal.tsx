'use client';

import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { isRoundCancelConfirmationValid } from './page.logic';

interface RoundCancelModalProps {
  opened: boolean;
  roundName: string;
  /** 멈춘 취소를 이어서 진행하는지 */
  resume: boolean;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// 회차 취소(관리자 전용). 되돌릴 수 없으므로 회차 이름을 그대로 입력해야 보낸다.
// 서버는 결제된 주문을 하나씩 환불하므로 끝날 때까지 창을 닫지 못하게 한다.
export function RoundCancelModal({
  opened,
  roundName,
  resume,
  loading,
  onConfirm,
  onClose,
}: RoundCancelModalProps) {
  const [typedName, setTypedName] = useState('');
  const confirmed = isRoundCancelConfirmationValid(typedName, roundName);

  useEffect(() => {
    if (opened) setTypedName('');
  }, [opened]);

  const close = () => {
    if (!loading) onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={
        <Text style={{ fontWeight: 'var(--fw-bold)' }}>
          {resume ? '회차 취소 다시 진행' : '회차 취소'}
        </Text>
      }
      radius="lg"
      centered
      closeOnClickOutside={!loading}
      closeOnEscape={!loading}
      withCloseButton={!loading}
    >
      <Stack gap="sm">
        {resume && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
            멈춘 회차 취소를 이어서 진행해요. 이미 환불한 주문은 다시 환불하지 않아요.
          </Text>
        )}
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          결제된 주문은 모두 환불되고, 고객에게 회차 취소 안내 알림톡(정해진 사유 문구)이 가요.
          되돌릴 수 없어요.
        </Text>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          환불을 주문마다 하나씩 처리해서 몇 분 걸릴 수 있어요. 끝날 때까지 이 화면을 닫지 마세요.
        </Text>
        <TextInput
          label="확인을 위해 회차 이름을 그대로 입력해 주세요"
          description={roundName}
          value={typedName}
          onChange={(event) => setTypedName(event.currentTarget.value)}
          disabled={loading}
          autoComplete="off"
        />
        <Group gap="xs">
          <Button
            onClick={onConfirm}
            disabled={!confirmed || loading}
            flex={1}
            color="red"
            radius="xl"
            style={{ fontWeight: 'var(--fw-medium)' }}
          >
            {loading ? '취소하는 중…' : resume ? '다시 진행' : '회차 취소'}
          </Button>
          <Button
            onClick={close}
            disabled={loading}
            flex={1}
            radius="xl"
            variant="outline"
            color="gray"
          >
            닫기
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
