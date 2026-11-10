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
import type { BatchPickupConfirmContent } from '../_lib/batch-pickup';

interface BatchPickupConfirmDialogProps {
  opened: boolean;
  content: BatchPickupConfirmContent | null;
  /** 확인 버튼을 눌러도 되는가. 부모의 실행 중·목록 신뢰도 판정을 그대로 받는다. */
  confirmDisabled: boolean;
  onClose: () => void;
  /** 확인. 요청은 부모가 주문마다 차례로 보낸다. 이 창은 요청을 직접 보내지 않는다. */
  onConfirm: () => void;
}

/**
 * 한 번에 수거 확인 창. 상세의 배송 시작 확인 창(StatusConfirmDialog)과 같은 구조로
 * 어느 집들인지(주소 목록), 상품이 모두 몇 개인지, 손님 몇 명에게 알림이 가는지 보이고 확인을 받는다.
 */
export function BatchPickupConfirmDialog({
  opened,
  content,
  confirmDisabled,
  onClose,
  onConfirm,
}: BatchPickupConfirmDialogProps) {
  return (
    <Dialog
      open={opened && content !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        {/* 하단 탭(z 100) 위를 덮도록 오버레이·창을 z 200으로 둔다(상세 확인 창과 같다). */}
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
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {content.places.map((entry) => (
                      <li
                        key={entry.id}
                        className={text}
                        style={{
                          fontWeight: 'var(--fw-bold)',
                          color: 'var(--color-text)',
                          wordBreak: 'keep-all',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {entry.place}
                      </li>
                    ))}
                  </ul>
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
                  <p className={text} style={{ color: 'var(--color-text)' }}>
                    {content.notice}
                  </p>
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
