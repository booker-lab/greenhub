'use client';

import { Button } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import type { ReactNode } from 'react';

interface ConfirmModalProps {
  opened: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  loading?: boolean;
  /** 확인 버튼만 잠근다(필수 입력 전 등). 처리 중 표시는 loading이 담당한다. */
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

// ① 외형 유지(UI 교체 P2b): Mantine 확인 버튼 color 값을 같은 색의 Button으로 옮긴다(filled gray-6·green-6은 Mantine 계산값).
const CONFIRM_BUTTON: Record<string, { variant: 'default' | 'destructive'; className?: string }> = {
  brand: { variant: 'default' },
  red: { variant: 'destructive' },
  gray: { variant: 'default', className: 'bg-[#868e96]' },
  green: { variant: 'default', className: 'bg-[#40c057]' },
};

export function ConfirmModal({
  opened,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  confirmColor = 'red',
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const confirm = CONFIRM_BUTTON[confirmColor] ?? CONFIRM_BUTTON.red;
  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="leading-[1.55] font-bold">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            {typeof message === 'string' ? (
              <p
                className="m-0 p-0 text-base"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'pre-line',
                }}
              >
                {message}
              </p>
            ) : (
              message
            )}
            <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
              <Button
                onClick={onConfirm}
                disabled={loading || confirmDisabled}
                variant={confirm.variant}
                className={`flex-1 ${confirm.className ?? ''}`}
                style={{ fontWeight: 'var(--fw-medium)' }}
              >
                {loading ? '처리 중...' : confirmLabel}
              </Button>
              <Button
                onClick={onClose}
                disabled={loading}
                variant="outline-gray"
                className="flex-1"
              >
                {cancelLabel}
              </Button>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
