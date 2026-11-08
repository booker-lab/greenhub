'use client';

import {
  Dialog,
  DialogBody,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { useRef, useState } from 'react';
import { AppButton } from '@/components/app-button';
import { text } from '@/components/look';

/**
 * 내 정보 로그아웃 버튼. 배송 중·보류 주문이 있으면(confirmMessage) 확인 창을 거친 뒤 같은 server action을 제출한다.
 * 확인 문구가 없으면(주문이 없거나 건수를 읽지 못함) 예전처럼 바로 제출한다.
 */
export function LogoutButton({
  action,
  confirmMessage,
}: {
  action: () => Promise<void>;
  confirmMessage: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [opened, setOpened] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form ref={formRef} action={action} onSubmit={() => setSubmitting(true)}>
      <AppButton
        type={confirmMessage ? 'button' : 'submit'}
        fullWidth
        tone="default"
        size="md"
        loading={submitting}
        disabled={submitting}
        onClick={confirmMessage ? () => setOpened(true) : undefined}
      >
        로그아웃
      </AppButton>
      {confirmMessage && (
        <Dialog open={opened} onOpenChange={setOpened}>
          <DialogPortal>
            {/* 하단 탭(z 100) 위를 덮도록 배송 보류 창과 같은 z 200으로 둔다. */}
            <DialogOverlay className="z-[200]" />
            <DialogPopup
              data-slot="dialog-content"
              className="fixed inset-0 z-[200] m-auto flex h-fit w-[min(400px,90vw)] flex-col rounded-lg bg-background text-ui-ink shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] outline-none"
            >
              <DialogHeader>
                <DialogTitle className="m-0 p-0 text-ui-ink">로그아웃</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <div className="flex flex-col gap-4">
                  <p className={text}>{confirmMessage}</p>
                  <div className="flex flex-wrap items-center justify-end gap-4">
                    <AppButton tone="default" onClick={() => setOpened(false)}>
                      취소
                    </AppButton>
                    <AppButton
                      tone="red"
                      onClick={() => {
                        setOpened(false);
                        formRef.current?.requestSubmit();
                      }}
                    >
                      로그아웃
                    </AppButton>
                  </div>
                </div>
              </DialogBody>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      )}
    </form>
  );
}
