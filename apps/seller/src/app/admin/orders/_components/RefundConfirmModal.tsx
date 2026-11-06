'use client';

import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Textarea } from '@greenhub/ui/components/textarea';
import { useId, useState } from 'react';
import type { AdminOrder } from '@/hooks/useAdmin';
import { AdminConfirmDialog, type AdminConfirmRow } from '../../_components/AdminConfirmDialog';
import { formatWon, maskPersonName } from '../../_components/adminList';
import { describeRefundTarget, formatOrderedAt, REFUND_REASON_MAX_LENGTH } from '../_lib';

interface RefundConfirmModalProps {
  /** 환불할 주문. null이면 닫힌다. */
  target: AdminOrder | null;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** 환불 확인창 대상 정보 — 상품·가게·주문자(가린 이름)·주문 시각. 값이 없는 줄은 뺀다(지어내지 않는다). */
export function describeRefundFacts(
  order: Pick<AdminOrder, 'productSummary' | 'storeName' | 'buyerName' | 'createdAt'>,
): AdminConfirmRow[] {
  const rows: AdminConfirmRow[] = [];
  const product = order.productSummary?.trim();
  if (product) rows.push({ label: '상품', value: product });
  const store = order.storeName?.trim();
  if (store) rows.push({ label: '가게', value: store });
  const buyer = maskPersonName(order.buyerName);
  if (buyer) rows.push({ label: '주문자', value: buyer });
  const orderedAt = formatOrderedAt(order.createdAt);
  if (orderedAt !== '—') rows.push({ label: '주문 시각', value: orderedAt });
  return rows;
}

// 강제환불은 되돌릴 수 없는 전액 환불이다(design-direction.md §5 어드민 "위험 동작 확인창", "적용 때 정한 것").
// 사유는 지금처럼 자유 입력(선택)이고, 스스로 확인하는 장치는 "되돌릴 수 없음을 확인했습니다" 체크다. 요청 본문은 바뀌지 않는다.
// 결제 대기 주문은 목록 메뉴처럼 "주문 취소"로 부른다(결제 전이면 돌려줄 돈 없이 취소된다).
// 강제환불은 배송 전 주문만 받으므로(정산은 배송 완료 때 만든다) 돈의 흐름은 "아직 정산 전"이다.
// 사유 입력란이 먼저 초점을 받아 Enter만 눌러서는 환불되지 않는다(data-autofocus).
export function RefundConfirmModal({
  target,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
}: RefundConfirmModalProps) {
  const reasonId = useId();
  // 확인 체크는 열 때마다 비운다(미리 켜 둔 확인창 금지). 대상이 바뀌면(닫힘 포함) 렌더 중에 지운다.
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [shownTarget, setShownTarget] = useState(target);
  if (shownTarget !== target) {
    setShownTarget(target);
    setAckFor(null);
  }
  const acknowledged = target !== null && ackFor === target.id;
  const label = target ? describeRefundTarget(target) : null;
  const amount = target ? formatWon(target.totalAmount) : '';
  const cancelling = target?.status === 'PENDING';
  return (
    <AdminConfirmDialog
      open={target !== null}
      title={label ? `주문 ${label.orderLabel} ${cancelling ? '취소' : '환불'}` : ''}
      lead={
        cancelling
          ? '주문을 취소합니다. 결제가 끝난 주문이면 결제한 금액 전액을 주문자에게 돌려줍니다.'
          : '결제한 금액 전액을 주문자에게 바로 돌려주고 주문을 취소합니다.'
      }
      facts={target ? describeRefundFacts(target) : undefined}
      flow={[
        { label: cancelling ? '결제됐으면 돌려줄 금액' : '주문자에게 돌려줄 금액', value: amount },
        { label: '가게 정산', value: '아직 정산 전' },
      ]}
      warning={
        cancelling
          ? '되돌릴 수 없습니다.'
          : '결제한 금액 전액을 바로 환불합니다. 되돌릴 수 없습니다.'
      }
      check={{
        label: '되돌릴 수 없음을 확인했습니다',
        checked: acknowledged,
        onChange: (checked) => setAckFor(checked && target ? target.id : null),
      }}
      confirmLabel={cancelling ? '주문 취소' : `${amount} 전액 환불`}
      confirmDisabled={!acknowledged}
      disabledHint={`되돌릴 수 없음을 확인하면 ${cancelling ? '취소' : '환불'} 버튼이 켜집니다.`}
      initialFocus="field"
      onConfirm={onConfirm}
      onClose={onClose}
    >
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
    </AdminConfirmDialog>
  );
}
