'use client';

import {
  POST_DELIVERY_REFUND_MEMO_MAX_LENGTH,
  POST_DELIVERY_REFUND_REASON_CODES,
  POST_DELIVERY_REFUND_REASON_LABEL,
  type PostDeliveryRefundReasonCode,
} from '@greenhub/shared';
import { Radio, Stack, Text, TextInput } from '@mantine/core';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { AdminOrder } from '@/hooks/useAdmin';
import { describeRefundTarget } from '../_lib';

interface PostDeliveryRefundModalProps {
  /** 환불할 주문. null이면 닫힌다. */
  target: AdminOrder | null;
  reasonCode: PostDeliveryRefundReasonCode | null;
  onReasonCodeChange: (code: PostDeliveryRefundReasonCode) => void;
  memo: string;
  onMemoChange: (memo: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** 사유를 골랐고 한 줄 메모(1~200자)가 있어야 확정할 수 있다. 서버 DTO 검증과 같은 조건. */
export function canConfirmPostDeliveryRefund(
  reasonCode: PostDeliveryRefundReasonCode | null,
  memo: string,
): boolean {
  const trimmed = memo.trim();
  return (
    reasonCode !== null &&
    trimmed.length > 0 &&
    trimmed.length <= POST_DELIVERY_REFUND_MEMO_MAX_LENGTH &&
    !/[\r\n]/.test(memo)
  );
}

// 관리자 배송 후 환불(기간 제한 없음). 정산금이 이미 지급됐으면 정산 화면에 "돌려받을 돈"이 생긴다.
export function PostDeliveryRefundModal({
  target,
  reasonCode,
  onReasonCodeChange,
  memo,
  onMemoChange,
  onConfirm,
  onClose,
}: PostDeliveryRefundModalProps) {
  const label = target ? describeRefundTarget(target) : null;
  const ready = canConfirmPostDeliveryRefund(reasonCode, memo);
  return (
    <ConfirmModal
      opened={target !== null}
      title="배송 후 환불"
      message={
        <Stack gap="xs">
          <Text style={{ fontSize: 'var(--font-size-sm)' }}>
            주문번호{' '}
            <Text component="span" ff="monospace" style={{ fontWeight: 'var(--fw-bold)' }}>
              {label?.orderLabel}
            </Text>{' '}
            · 결제 금액 전액{' '}
            <Text component="span" style={{ fontWeight: 'var(--fw-bold)' }}>
              {label?.amountLabel}
            </Text>
          </Text>
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-danger)',
            }}
          >
            배송이 끝난 주문을 전액 환불하고 취소합니다. 되돌릴 수 없습니다. 정산금이 이미
            지급됐으면 정산 화면에 &quot;돌려받을 돈&quot;으로 표시됩니다.
          </Text>
          <Radio.Group
            label="환불 사유"
            value={reasonCode}
            onChange={(value) => onReasonCodeChange(value as PostDeliveryRefundReasonCode)}
          >
            <Stack gap={6} mt={6}>
              {POST_DELIVERY_REFUND_REASON_CODES.map((code) => (
                <Radio key={code} value={code} label={POST_DELIVERY_REFUND_REASON_LABEL[code]} />
              ))}
            </Stack>
          </Radio.Group>
          <TextInput
            label="메모 (손님에게는 보이지 않음, 필수)"
            maxLength={POST_DELIVERY_REFUND_MEMO_MAX_LENGTH}
            value={memo}
            onChange={(e) => onMemoChange(e.currentTarget.value)}
            radius="md"
            data-autofocus
          />
          {!ready && (
            <Text style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}>
              사유를 고르고 메모를 한 줄 적어야 환불할 수 있습니다.
            </Text>
          )}
        </Stack>
      }
      confirmLabel="전액 환불"
      confirmColor="red"
      confirmDisabled={!ready}
      onConfirm={() => {
        if (ready) onConfirm();
      }}
      onClose={onClose}
    />
  );
}
