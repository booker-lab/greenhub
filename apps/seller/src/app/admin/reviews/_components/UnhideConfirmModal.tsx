'use client';

import { type AdminHiddenReview, REVIEW_HIDE_REASON_MAX_LENGTH } from '@greenhub/shared';
import { Field, FieldLabel } from '@greenhub/ui/components/field';
import { Textarea } from '@greenhub/ui/components/textarea';
import { useId } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';

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
export function UnhideConfirmModal({
  target,
  reason,
  onReasonChange,
  busy,
  onConfirm,
  onClose,
}: UnhideConfirmModalProps) {
  const reasonId = useId();
  // ① 외형 유지(UI 교체 P2b): Mantine Stack(gap xs)·Text·Textarea(radius md, autosize 2줄).
  // 열리면 data-autofocus인 사유 칸이 첫 초점이다(Mantine Modal 약속, Dialog가 지킨다).
  return (
    <ConfirmModal
      opened={target !== null}
      title="숨김 해제"
      message={
        <div className="flex flex-col gap-2.5">
          <p
            className="m-0 p-0 text-base"
            style={{ fontSize: 'var(--font-size-sm)', overflowWrap: 'anywhere' }}
          >
            {target
              ? `${target.storeName ?? target.storeId} · ${target.productName ?? '삭제된 상품'}`
              : ''}
          </p>
          <p
            className="m-0 p-0 text-base"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            이 후기를 다시 고객에게 보이고 별점에 넣을까요?
          </p>
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
        </div>
      }
      confirmLabel="숨김 해제"
      confirmColor="green"
      loading={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
