'use client';

import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Textarea } from '@greenhub/ui/components/textarea';
import { useId } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { AdminOrder } from '@/hooks/useAdmin';
import { describeRefundTarget, REFUND_REASON_MAX_LENGTH } from '../_lib';
import { INNER_TEXT, MONOSPACE, TEXT } from './text';

interface RefundConfirmModalProps {
  /** 환불할 주문. null이면 닫힌다. */
  target: AdminOrder | null;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

// 강제환불은 되돌릴 수 없는 전액 환불이라 대상(주문번호·금액)과 경고를 함께 보여 준다.
// 사유 입력란이 먼저 포커스를 받아 Enter만 눌러서는 환불되지 않는다(Dialog의 data-autofocus).
// ① 외형 유지(UI 교체 P2b): Mantine Stack(간격 10)·Textarea(radius md = 8px) 값. 글자는 ./text.
export function RefundConfirmModal({
  target,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
}: RefundConfirmModalProps) {
  const label = target ? describeRefundTarget(target) : null;
  const reasonId = useId();
  return (
    <ConfirmModal
      opened={target !== null}
      title="강제환불"
      message={
        <div className="flex flex-col gap-2.5">
          <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
            주문번호{' '}
            <span
              className={INNER_TEXT}
              style={{ fontFamily: MONOSPACE, fontWeight: 'var(--fw-bold)' }}
            >
              {label?.orderLabel}
            </span>
          </p>
          <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
            환불 금액{' '}
            <span className={INNER_TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
              {label?.amountLabel}
            </span>{' '}
            (결제 금액 전액)
          </p>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-danger)',
            }}
          >
            결제한 금액 전액을 바로 환불합니다. 되돌릴 수 없습니다.
          </p>
          <Field>
            <FieldLabel htmlFor={reasonId}>환불 사유 (선택)</FieldLabel>
            <Textarea
              id={reasonId}
              placeholder="비워 두면 '관리자 강제 환불'로 기록됩니다"
              maxLength={REFUND_REASON_MAX_LENGTH}
              value={reason}
              onChange={(e) => onReasonChange(e.currentTarget.value)}
              autosize
              minRows={2}
              className="rounded-[8px]"
              data-autofocus
            />
          </Field>
        </div>
      }
      confirmLabel="전액 환불"
      confirmColor="red"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
