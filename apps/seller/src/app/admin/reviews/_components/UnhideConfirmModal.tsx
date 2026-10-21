'use client';

import { type AdminHiddenReview, REVIEW_HIDE_REASON_MAX_LENGTH } from '@greenhub/shared';
import { Stack, Text, Textarea } from '@mantine/core';
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
  return (
    <ConfirmModal
      opened={target !== null}
      title="숨김 해제"
      message={
        <Stack gap="xs">
          <Text style={{ fontSize: 'var(--font-size-sm)', overflowWrap: 'anywhere' }}>
            {target
              ? `${target.storeName ?? target.storeId} · ${target.productName ?? '삭제된 상품'}`
              : ''}
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            이 후기를 다시 고객에게 보이고 별점에 넣을까요?
          </Text>
          <Textarea
            label="해제 사유 (선택)"
            placeholder="예: 개인정보가 아닌 내용으로 확인"
            maxLength={REVIEW_HIDE_REASON_MAX_LENGTH}
            value={reason}
            onChange={(e) => onReasonChange(e.currentTarget.value)}
            autosize
            minRows={2}
            radius="md"
            data-autofocus
          />
        </Stack>
      }
      confirmLabel="숨김 해제"
      confirmColor="green"
      loading={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
