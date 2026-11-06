'use client';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { Input } from '@greenhub/ui/components/input';

interface ManualCopyModalProps {
  /** 자동 복사에 실패한 초대 링크. null이면 닫힘. */
  link: string | null;
  onClose: () => void;
}

// 클립보드 복사 실패 폴백 — 초대 링크를 선택된 상태로 보여 줘 사용자가 직접 복사(Ctrl+C·길게 누르기)하게 한다.
// ① 외형 유지(UI 교체 P2b): Mantine Modal(radius lg)·Stack(gap sm)·Text·TextInput(radius md, 고정폭 글꼴)과 같은 값.
// 열리면 data-autofocus인 링크 칸이 첫 초점이다(Mantine Modal 약속, Dialog가 지킨다).
export function ManualCopyModal({ link, onClose }: ManualCopyModalProps) {
  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="leading-[1.55] font-bold">초대 링크 직접 복사</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <p
              className="m-0 p-0 text-base"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              자동 복사를 할 수 없어요. 아래 초대 링크를 선택해 복사해 주세요.
            </p>
            <Input
              value={link ?? ''}
              readOnly
              data-autofocus
              aria-label="초대 링크"
              className="rounded-[8px]"
              style={{ fontFamily: 'monospace' }}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
            />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
