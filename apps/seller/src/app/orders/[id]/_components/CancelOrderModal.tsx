'use client';

import { Button } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Textarea } from '@greenhub/ui/components/textarea';

interface CancelOrderModalProps {
  opened: boolean;
  cancelReason: string;
  setCancelReason: (v: string) => void;
  actionLoading: boolean;
  actionError: string | null;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  /** 사유 안내 아래에 덧붙일 설명(환불 금액·범위와 되돌릴 수 없음) */
  note?: string;
}

// ① 외형 유지(UI 교체 P4): Mantine Modal(가운데 아님 = 위 5dvh, radius lg)·Stack(gap sm = 12px)·
// Text(p, 여백 0, 줄 높이 1.55)·Textarea(rows 3, radius md)·Group(gap xs)과 같은 값.
const TEXT = 'm-0 p-0 text-base font-normal';

export function CancelOrderModal({
  opened,
  cancelReason,
  setCancelReason,
  actionLoading,
  actionError,
  onClose,
  onConfirm,
  title = '주문 취소',
  note,
}: CancelOrderModalProps) {
  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent align="top">
        <DialogHeader>
          <DialogTitle className="leading-[1.55] font-bold">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              취소 사유를 적어 주세요. 손님에게 알림톡으로 전해져요.
            </p>
            {/* 환불 금액·되돌릴 수 없음은 확정 전에 꼭 읽어야 해서 사유 안내보다 진하게 쓴다. */}
            {note && (
              <p
                className={TEXT}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text)',
                  fontWeight: 'var(--fw-medium)',
                }}
              >
                {note}
              </p>
            )}
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="취소 사유 입력 (최소 5자)"
              rows={3}
              className="rounded-[8px]"
            />
            {cancelReason.length > 0 && cancelReason.trim().length < 5 && (
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                최소 5자 이상 입력해주세요
              </p>
            )}
            {actionError && (
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                {actionError}
              </p>
            )}
            <div className="flex flex-row flex-wrap items-center justify-start gap-2.5">
              <Button
                onClick={onConfirm}
                disabled={actionLoading || cancelReason.trim().length < 5}
                variant="destructive"
                className="flex-1"
                style={{ fontWeight: 'var(--fw-medium)' }}
              >
                {actionLoading ? '처리 중...' : '취소 확정'}
              </Button>
              <Button onClick={onClose} variant="outline-gray" className="flex-1">
                닫기
              </Button>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
