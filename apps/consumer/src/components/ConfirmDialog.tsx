'use client';

import { Button } from '@greenhub/ui/components/button';
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
import { LoadingButton } from '@/components/LoadingButton';
import type { ConfirmDialogContent, ConfirmRow } from '@/lib/confirm-dialog-content';

/** 확인창 상태. 닫힘 → 열림 → 처리 중(확정을 누른 뒤 요청이 끝날 때까지) 중 하나다. */
export type ConfirmDialogState = 'closed' | 'open' | 'submitting';

// ② 방향(design-direction §5 "위험 동작 확인창", design-standard §5 소비자 마이페이지): 주문 취소·배송지 삭제가 쓰는 하나의 틀.
// 제목 = 동작 + 대상 → 대상 정보 상자 → 돈의 흐름 상자 → 빨간 한 줄 → 닫기(외곽선)·초록 확정 하나.
// 확정 버튼은 위험도와 상관없이 초록 한 가지이고 빨간 채움 버튼은 쓰지 않는다. 스스로 확인하는 체크는 두지 않는다.
// 닫기 버튼이 따로 있으므로 오른쪽 위 X는 두지 않는다. 열리면 첫 초점은 닫기에 간다(확정이 첫 초점이면 Enter 한 번에 실행된다).
// 처리 중에는 Esc·바깥 누름·닫기로 닫히지 않는다.
// 하단 탭(z 100)을 덮어야 해서 배송지 추가 창처럼 DialogContent와 같은 구조(오버레이·뷰포트·DialogPopup)를 풀어 z 200으로 둔다.
// 창 본체는 DialogPopup이라 Tab 순회가 창 안에서만 돌고 aria-modal이 붙는다.
export function ConfirmDialog({
  state,
  content,
  onConfirm,
  onClose,
}: {
  state: ConfirmDialogState;
  /** 닫힌 동안에는 null을 줘도 된다. 닫히는 전환 동안에는 마지막 내용을 그대로 보인다. */
  content: ConfirmDialogContent | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // 닫히는 전환(투명도) 동안 내용이 비지 않게 마지막 내용을 기억한다.
  const [retained, setRetained] = useState(content);
  if (content !== null && content !== retained) setRetained(content);
  const shown = content ?? retained;
  const submitting = state === 'submitting';

  return (
    <Dialog
      open={state !== 'closed'}
      onOpenChange={(open) => {
        // 처리 중에는 닫지 않는다(요청이 끝나면 부르는 쪽이 닫는다).
        if (!open && state === 'open') onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="z-[200]" />
        <div
          data-slot="dialog-viewport"
          className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-[5vw] py-[5dvh]"
        >
          <DialogPopup
            data-slot="dialog-content"
            initialFocus={closeRef}
            className="pointer-events-auto relative flex max-h-[90dvh] w-[440px] max-w-full flex-col overflow-y-auto rounded-lg bg-popover text-ui-ink shadow-[0_1px_3px_rgba(0,0,0,0.05),rgba(0,0,0,0.05)_0_36px_28px_-7px,rgba(0,0,0,0.04)_0_17px_17px_-7px] outline-none will-change-[opacity] duration-100 [overflow-wrap:anywhere] [word-break:keep-all] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <DialogHeader className="pr-4">
              <DialogTitle
                className="leading-[1.4]"
                style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}
              >
                {shown?.title}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <div className="flex flex-col gap-3">
                {shown && shown.facts.length > 0 && <ConfirmRows rows={shown.facts} />}
                {shown && shown.flow.length > 0 && <ConfirmRows rows={shown.flow} numeric />}
                {shown?.warning && (
                  <p
                    className="m-0 text-sm"
                    style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-danger)' }}
                  >
                    {shown.warning}
                  </p>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    ref={closeRef}
                    type="button"
                    variant="plain"
                    size="md"
                    className="max-sm:w-full"
                    disabled={submitting}
                    onClick={onClose}
                    data-autofocus
                  >
                    닫기
                  </Button>
                  <LoadingButton
                    type="button"
                    size="md"
                    className="max-sm:w-full"
                    loading={submitting}
                    onClick={() => {
                      if (state === 'open') onConfirm();
                    }}
                  >
                    {shown?.confirmLabel}
                  </LoadingButton>
                </div>
              </div>
            </DialogBody>
          </DialogPopup>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

// 이름–값 줄. 연회색 면(소비자 안내 상자와 같은 면) 안에 줄마다 구분선을 긋고, 긴 값은 말줄임 없이 줄을 나눈다.
function ConfirmRows({ rows, numeric = false }: { rows: ConfirmRow[]; numeric?: boolean }) {
  return (
    <dl className="m-0 rounded-[var(--radius)] bg-[var(--color-surface-muted)]">
      {rows.map((row, index) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm"
          style={index > 0 ? { borderTop: 'var(--border)' } : undefined}
        >
          <dt className="shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
            {row.label}
          </dt>
          <dd
            className="m-0 min-w-0 text-right"
            style={{
              fontWeight: 'var(--fw-bold)',
              fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
            }}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
