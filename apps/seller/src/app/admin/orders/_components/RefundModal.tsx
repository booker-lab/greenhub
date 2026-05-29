'use client';

import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AdminOrder } from '@/hooks/useAdmin';
import { REFUNDABLE_RISK, STATUS_LABEL } from '../_lib';

interface RefundModalProps {
  order: AdminOrder | null;
  processing: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
}

export function RefundModal({ order, processing, onClose, onConfirm }: RefundModalProps) {
  const [reason, setReason] = useState('');
  const trimmedReason = reason.trim();
  const isRiskStage = useMemo(
    () => (order ? REFUNDABLE_RISK.includes(order.status) : false),
    [order],
  );
  const confirmDisabled = isRiskStage && trimmedReason.length < 5;

  useEffect(() => {
    if (order) setReason('');
  }, [order]);

  const handleConfirm = () => {
    if (confirmDisabled || processing) return;
    onConfirm(trimmedReason || undefined);
  };

  return (
    <Modal
      opened={order !== null}
      onClose={onClose}
      title="강제환불"
      centered
      radius="md"
      closeOnClickOutside={!processing}
      closeOnEscape={!processing}
    >
      <Stack gap="md">
        {order && (
          <Stack gap={4}>
            <Text size="sm" c="dimmed">
              주문 {order.orderNumber ?? order.id.slice(0, 12)}
            </Text>
            <Text size="sm">현재 상태: {STATUS_LABEL[order.status] ?? order.status}</Text>
          </Stack>
        )}

        {isRiskStage && (
          <Alert color="red" icon={<AlertTriangle size={18} />} radius="md">
            배달 진행 후 환불입니다. 정산·고객 영향이 큽니다.
          </Alert>
        )}

        <Textarea
          label={isRiskStage ? '환불 사유' : '환불 사유(선택)'}
          placeholder={
            isRiskStage
              ? '배달 후 환불 사유를 5자 이상 입력하세요.'
              : '필요하면 환불 사유를 입력하세요.'
          }
          minRows={4}
          minLength={isRiskStage ? 5 : undefined}
          required={isRiskStage}
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          disabled={processing}
        />

        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" color="gray" onClick={onClose} disabled={processing}>
            취소
          </Button>
          <Button
            color="red"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            loading={processing}
          >
            환불 처리
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
