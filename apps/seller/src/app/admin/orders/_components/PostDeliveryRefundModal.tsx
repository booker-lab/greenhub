'use client';

import {
  POST_DELIVERY_REFUND_MEMO_MAX_LENGTH,
  POST_DELIVERY_REFUND_REASON_CODES,
  POST_DELIVERY_REFUND_REASON_LABEL,
  type PostDeliveryRefundReasonCode,
} from '@greenhub/shared';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { RadioGroup, RadioItem } from '@greenhub/ui/components/radio';
import { useId } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { AdminOrder } from '@/hooks/useAdmin';
import { describeRefundTarget } from '../_lib';
import { INNER_TEXT, MONOSPACE, TEXT } from './text';

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
  const reasonLabelId = useId();
  const reasonName = useId();
  const memoId = useId();
  return (
    <ConfirmModal
      opened={target !== null}
      title="배송 후 환불"
      message={
        <div className="flex flex-col gap-2.5">
          <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
            주문번호{' '}
            <span
              className={INNER_TEXT}
              style={{ fontFamily: MONOSPACE, fontWeight: 'var(--fw-bold)' }}
            >
              {label?.orderLabel}
            </span>{' '}
            · 결제 금액 전액{' '}
            <span className={INNER_TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
              {label?.amountLabel}
            </span>
          </p>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-danger)',
            }}
          >
            배송이 끝난 주문을 전액 환불하고 취소합니다. 되돌릴 수 없습니다. 정산금이 이미
            지급됐으면 정산 화면에 &quot;돌려받을 돈&quot;으로 표시됩니다.
          </p>
          <div>
            <div id={reasonLabelId} className={GROUP_LABEL}>
              환불 사유
            </div>
            <RadioGroup
              aria-labelledby={reasonLabelId}
              name={reasonName}
              value={reasonCode}
              onValueChange={onReasonCodeChange}
            >
              <div className="mt-1.5 flex flex-col gap-1.5">
                {POST_DELIVERY_REFUND_REASON_CODES.map((code) => (
                  <RadioItem
                    key={code}
                    value={code}
                    label={POST_DELIVERY_REFUND_REASON_LABEL[code]}
                  />
                ))}
              </div>
            </RadioGroup>
          </div>
          <Field>
            <FieldLabel htmlFor={memoId}>메모 (손님에게는 보이지 않음, 필수)</FieldLabel>
            <Input
              id={memoId}
              maxLength={POST_DELIVERY_REFUND_MEMO_MAX_LENGTH}
              value={memo}
              onChange={(e) => onMemoChange(e.currentTarget.value)}
              className="rounded-[8px]"
              data-autofocus
            />
          </Field>
          {!ready && (
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-disabled)' }}
            >
              사유를 고르고 메모를 한 줄 적어야 환불할 수 있습니다.
            </p>
          )}
        </div>
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

// ① 외형 유지(UI 교체 P2b): Mantine Radio.Group 라벨(InputWrapper 라벨, div)과 Radio(sm: 원 20px, 테두리 gray-4,
// 고르면 주색 바탕·흰 점, 글자 14px/20px·왼쪽 12px) 값. 기사 앱 RadioGroupField와 같은 계산값이다.
const GROUP_LABEL =
  'inline-block cursor-default text-sm/[1.55] font-semibold break-words text-black';
