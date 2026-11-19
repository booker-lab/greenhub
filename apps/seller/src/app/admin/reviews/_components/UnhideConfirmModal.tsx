'use client';

import { type AdminHiddenReview, REVIEW_HIDE_REASON_MAX_LENGTH } from '@greenhub/shared';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Textarea } from '@greenhub/ui/components/textarea';
import { useId } from 'react';
import { hiddenReasonLabel } from '../../../reactions/_lib';
import { AdminConfirmDialog } from '../../_components/AdminConfirmDialog';

interface UnhideConfirmModalProps {
  /** 숨김 해제할 후기. null이면 닫힌다. */
  target: AdminHiddenReview | null;
  reason: string;
  onReasonChange: (reason: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// 숨김 해제는 후기를 고객 화면·별점에 다시 넣는다. 어떤 후기인지 보여 주고,
// 해제 사유(선택)를 받아 서버 이력에 남긴다.
// 어드민 위험 동작 확인창 틀(AdminConfirmDialog): 제목 = 동작 + 대상 → 한 줄 결과 → 대상 상자 → 사유 입력 → 닫기 + 초록 확정.
// 되돌릴 수 있는 동작(다시 숨길 수 있다)이라 빨간 경고 줄은 두지 않는다. 처음 초점은 사유 칸(data-autofocus).
export function UnhideConfirmModal({
  target,
  reason,
  onReasonChange,
  busy,
  onConfirm,
  onClose,
}: UnhideConfirmModalProps) {
  const reasonId = useId();
  const product = target?.productName ?? '삭제된 상품';
  return (
    <AdminConfirmDialog
      open={target !== null}
      title={`${product} 후기 숨김 해제`}
      lead="고객 화면과 별점에 다시 들어갑니다."
      facts={
        target
          ? [
              { label: '가게', value: target.storeName ?? target.storeId },
              { label: '작성자', value: target.authorName },
              { label: '숨긴 사유', value: hiddenReasonLabel(target) ?? '사유 없음' },
            ]
          : []
      }
      confirmLabel="숨김 해제"
      initialFocus="field"
      loading={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <Field>
        <FieldLabel htmlFor={reasonId}>해제 사유 (선택)</FieldLabel>
        <Textarea
          id={reasonId}
          placeholder="예: 개인정보가 아닌 내용으로 확인"
          maxLength={REVIEW_HIDE_REASON_MAX_LENGTH}
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
