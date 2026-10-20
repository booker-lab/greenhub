'use client';

import { Stack, Text, Textarea } from '@mantine/core';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { AdminOrder } from '@/hooks/useAdmin';
import { describeRefundTarget, REFUND_REASON_MAX_LENGTH } from '../_lib';

interface RefundConfirmModalProps {
  /** 환불할 주문. null이면 닫힌다. */
  target: AdminOrder | null;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

// 강제환불은 되돌릴 수 없는 전액 환불이라 대상(주문번호·금액)과 경고를 함께 보여 준다.
// 사유 입력란이 먼저 포커스를 받아 Enter만 눌러서는 환불되지 않는다.
export function RefundConfirmModal({
  target,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
}: RefundConfirmModalProps) {
  const label = target ? describeRefundTarget(target) : null;
  return (
    <ConfirmModal
      opened={target !== null}
      title="강제환불"
      message={
        <Stack gap="xs">
          <Text style={{ fontSize: 'var(--font-size-sm)' }}>
            주문번호{' '}
            <Text component="span" ff="monospace" style={{ fontWeight: 'var(--fw-bold)' }}>
              {label?.orderLabel}
            </Text>
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)' }}>
            환불 금액{' '}
            <Text component="span" style={{ fontWeight: 'var(--fw-bold)' }}>
              {label?.amountLabel}
            </Text>{' '}
            (결제 금액 전액)
          </Text>
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-danger)',
            }}
          >
            결제한 금액 전액을 바로 환불합니다. 되돌릴 수 없습니다.
          </Text>
          <Textarea
            label="환불 사유 (선택)"
            placeholder="비워 두면 '관리자 강제 환불'로 기록됩니다"
            maxLength={REFUND_REASON_MAX_LENGTH}
            value={reason}
            onChange={(e) => onReasonChange(e.currentTarget.value)}
            autosize
            minRows={2}
            radius="md"
            data-autofocus
          />
        </Stack>
      }
      confirmLabel="전액 환불"
      confirmColor="red"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
