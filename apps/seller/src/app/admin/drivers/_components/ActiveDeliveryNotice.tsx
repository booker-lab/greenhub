'use client';

import { Button } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';

interface ActiveDeliveryNoticeProps {
  /** 안내 문구. null이면 닫혀 있다. */
  message: string | null;
  onClose: () => void;
}

// 기사 정지 뒤 배송 중 배정 주문이 남아 있으면 확인창으로 알린다(정지는 이미 끝났다).
export function ActiveDeliveryNotice({ message, onClose }: ActiveDeliveryNoticeProps) {
  return (
    <Dialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="leading-[1.55] font-bold">
            배송 중인 주문을 확인해 주세요
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
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
            <Button onClick={onClose} className="w-full">
              확인
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
