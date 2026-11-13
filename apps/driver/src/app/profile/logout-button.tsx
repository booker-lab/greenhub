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
import { useFormStatus } from 'react-dom';
import {
  clearPendingPhotoQueue,
  usePendingPhotoCount,
} from '@/app/board/[orderId]/photo/pending-photo-client';
import { AppButton } from '@/components/app-button';
import { text } from '@/components/look';
import { type ActiveDeliverySummary, logoutConfirmMessage } from '@/lib/logout-confirm';

/**
 * 로그아웃 주 버튼. 폼의 실제 제출 상태(useFormStatus)로 잠근다. server action이 끝나면(정상은 signOut
 * 리다이렉트로 화면을 떠나고, 오류면 error boundary로 간다) 대기 상태가 풀리므로 시간으로 추정하지 않는다.
 */
function LogoutSubmitButton({
  confirmMessage,
  onOpenConfirm,
}: {
  confirmMessage: string | null;
  onOpenConfirm: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <AppButton
      type={confirmMessage ? 'button' : 'submit'}
      fullWidth
      tone="default"
      size="md"
      loading={pending}
      disabled={pending}
      onClick={confirmMessage ? onOpenConfirm : undefined}
    >
      로그아웃
    </AppButton>
  );
}

/**
 * 내 정보 로그아웃 버튼. 배송 중·보류 주문이나 올리지 못한 사진이 있으면(confirmMessage) 확인 창을 거친 뒤
 * 같은 server action을 제출한다. 확인 문구가 없으면(주문·사진이 없거나 건수를 읽지 못함) 예전처럼 바로 제출한다.
 *
 * 로그아웃은 이 기기의 사진 업로드 대기열을 지운다(세션 만료로 끝난 로그아웃은 지우지 않는다).
 * 확인 창에서는 지운 뒤 제출하고, 바로 제출할 때는 제출과 함께 지운다(건수를 읽기 전에 누른 경우도 덮는다).
 */
export function LogoutButton({
  action,
  activeDeliveries,
}: {
  action: () => Promise<void>;
  activeDeliveries: ActiveDeliverySummary | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [opened, setOpened] = useState(false);
  const pendingPhotos = usePendingPhotoCount();
  const confirmMessage = logoutConfirmMessage(activeDeliveries, pendingPhotos);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={() => {
        void clearPendingPhotoQueue();
      }}
    >
      <LogoutSubmitButton confirmMessage={confirmMessage} onOpenConfirm={() => setOpened(true)} />
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
                        // 올리지 못한 사진을 먼저 지우고 로그아웃을 제출한다.
                        void clearPendingPhotoQueue().finally(() =>
                          formRef.current?.requestSubmit(),
                        );
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
