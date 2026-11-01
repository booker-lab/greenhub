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
import type { AdminOrder } from '@/hooks/useAdmin';
import { AdminConfirmDialog } from '../../_components/AdminConfirmDialog';
import { formatWon } from '../../_components/adminList';
import { describeRefundTarget } from '../_lib';
import { describeRefundFacts } from './RefundConfirmModal';

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

// 관리자 배송 후 환불(기간 제한 없음, design-direction.md §5 어드민 "적용 때 정한 것": 배송 완료 행의 ⋮에서 연다).
// 사유를 고르고 메모를 적는 것이 스스로 확인하는 장치다(고르기 전에는 확정이 꺼져 있다).
// 정산은 배송 완료 때 만들어지지만 이 화면은 그 정산의 상태를 모르므로, 돈의 흐름은 지급 전·후 두 경우를 함께 쓴다.
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
  const amount = target ? formatWon(target.totalAmount) : '';
  const ready = canConfirmPostDeliveryRefund(reasonCode, memo);
  const reasonLabelId = useId();
  const reasonName = useId();
  const memoId = useId();
  return (
    <AdminConfirmDialog
      open={target !== null}
      title={label ? `주문 ${label.orderLabel} 배송 후 환불` : ''}
      lead="배송이 끝난 주문을 전액 환불하고 취소합니다."
      facts={target ? describeRefundFacts(target) : undefined}
      flow={[
        { label: '주문자에게 돌려줄 금액', value: amount },
        {
          label: '가게 정산',
          value: '지급 전이면 정산에서 빠지고, 이미 지급했으면 정산 화면에 "돌려받을 돈"으로 표시',
        },
      ]}
      warning="결제한 금액 전액을 바로 환불합니다. 되돌릴 수 없습니다."
      confirmLabel={`${amount} 전액 환불`}
      confirmDisabled={!ready}
      disabledHint="사유를 고르고 메모를 한 줄 적으면 환불 버튼이 켜집니다."
      initialFocus="field"
      onConfirm={() => {
        if (ready) onConfirm();
      }}
      onClose={onClose}
    >
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
              <RadioItem key={code} value={code} label={POST_DELIVERY_REFUND_REASON_LABEL[code]} />
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
    </AdminConfirmDialog>
  );
}

// ① 외형 유지(UI 교체 P2b): Mantine Radio.Group 라벨(InputWrapper 라벨, div)과 Radio(sm: 원 20px, 테두리 gray-4,
// 고르면 주색 바탕·흰 점, 글자 14px/20px·왼쪽 12px) 값. 기사 앱 RadioGroupField와 같은 계산값이다.
const GROUP_LABEL =
  'inline-block cursor-default text-sm/[1.55] font-semibold break-words text-black';
