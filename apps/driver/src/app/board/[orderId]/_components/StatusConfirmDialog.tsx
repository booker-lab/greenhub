'use client';

import { CloseIcon, closeButtonClassName } from '@greenhub/ui/components/close-button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { cn } from '@greenhub/ui/lib/utils';
import { AppButton } from '@/components/app-button';
import { text } from '@/components/look';
import type { DriverStatusConfirmContent } from '../../_lib/driver-order-detail';

interface StatusConfirmDialogProps {
  opened: boolean;
  content: DriverStatusConfirmContent | null;
  /** 확인 버튼을 눌러도 되는가. 부모의 loading·fail-closed 판정(commandsAllowed)을 그대로 받는다. */
  confirmDisabled: boolean;
  onClose: () => void;
  /** 확인. 요청 전송·in-flight·불확실 수렴은 부모의 updateStatus가 그대로 맡는다. */
  onConfirm: () => void;
}

/**
 * 배송 시작·재개 확인 창(D-02). 손님 알림이 가고 기사 화면에서 되돌릴 수 없는 전환이라
 * 어느 집·몇 개인지, 손님에게 무엇이 가는지 보이고 확인을 받는다. 이 창은 요청을 직접 보내지 않는다.
 */
export function StatusConfirmDialog({
  opened,
  content,
  confirmDisabled,
  onClose,
  onConfirm,
}: StatusConfirmDialogProps) {
  return (
    <Dialog
      open={opened && content !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        {/* 배송 보류 창(DeliveryHoldModal)과 같은 구조: 하단 탭(z 100) 위를 덮도록 오버레이·창을 z 200으로 둔다. */}
        <DialogOverlay className="z-[200]" />
        <DialogPopup
          data-slot="dialog-content"
          className="fixed inset-0 z-[200] m-auto flex h-fit max-h-[90dvh] w-[min(440px,90vw)] flex-col overflow-y-auto rounded-lg bg-background text-ui-ink shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] outline-none"
        >
          {content && (
            <>
              <DialogHeader>
                <DialogTitle className="m-0 p-0 text-ui-ink">{content.title}</DialogTitle>
              </DialogHeader>
              <DialogClose
                aria-label="닫기"
                className={cn(closeButtonClassName, 'appearance-none border-0 p-0')}
              >
                <CloseIcon />
              </DialogClose>
              <DialogBody>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    {content.placeBase && (
                      <p className={text} style={mutedText}>
                        {content.placeBase}
                      </p>
                    )}
                    <p
                      className={text}
                      style={{
                        fontSize: 'var(--font-size-xl)',
                        fontWeight: 'var(--fw-extrabold)',
                        lineHeight: 1.3,
                        color: 'var(--color-text)',
                        wordBreak: 'keep-all',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {content.place}
                    </p>
                    {content.itemsLine && (
                      <p
                        className={text}
                        style={{
                          fontWeight: 'var(--fw-bold)',
                          color: 'var(--color-text)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {content.itemsLine}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {content.assignment && (
                      <p className={text} style={{ color: 'var(--color-text)' }}>
                        {content.assignment}
                      </p>
                    )}
                    <p className={text} style={{ color: 'var(--color-text)' }}>
                      {content.notice}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-4">
                    <AppButton tone="default" onClick={onClose}>
                      취소
                    </AppButton>
                    <AppButton disabled={confirmDisabled} onClick={onConfirm}>
                      {content.confirmLabel}
                    </AppButton>
                  </div>
                </div>
              </DialogBody>
            </>
          )}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

const mutedText = { fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' } as const;
