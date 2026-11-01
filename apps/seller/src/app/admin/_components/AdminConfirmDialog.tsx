'use client';

import { Button } from '@greenhub/ui/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@greenhub/ui/components/dialog';
import { type ReactNode, useId } from 'react';

/** 확인창 이름–값 상자의 한 줄. */
export interface AdminConfirmRow {
  label: string;
  value: ReactNode;
}

export interface AdminConfirmCheck {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface AdminConfirmDialogProps {
  open: boolean;
  /** 동작 + 대상("주문 20261128-000014 환불", "이대기 님을 기사로 승인"). */
  title: string;
  /** 한 줄 결과: 이 버튼이 무엇을 바꾸는지. */
  lead?: ReactNode;
  /** 대상 정보(연한 회색 이름–값 상자). */
  facts?: AdminConfirmRow[];
  /** 돈이 움직이면 그 흐름(대상 정보와 같은 상자 모양). */
  flow?: AdminConfirmRow[];
  /** 사유 입력칸 등. 확인 체크·경고보다 앞에 둔다. */
  children?: ReactNode;
  /** 되돌릴 수 없으면 확정 버튼 바로 위의 빨간 한 줄. */
  warning?: ReactNode;
  /** 스스로 확인하는 장치. 비운 채 열고, 켜기 전에는 부르는 쪽이 확정을 끈다. */
  check?: AdminConfirmCheck;
  /** 확정 버튼 문구. 금액이나 이름을 넣는다. */
  confirmLabel: string;
  confirmDisabled?: boolean;
  /** 확정 버튼이 꺼져 있을 때 버튼 위에 쓰는 켜는 방법. */
  disabledHint?: ReactNode;
  loading?: boolean;
  /**
   * 처음 초점. close = 닫기 버튼(승인·정지처럼 입력이 없는 창), check = 확인 체크,
   * field = 안쪽 입력칸 중 data-autofocus가 붙은 것(부르는 쪽이 붙인다).
   */
  initialFocus?: 'close' | 'check' | 'field';
  onConfirm: () => void;
  onClose: () => void;
}

// ② 방향(design-direction.md §5 어드민 "위험 동작 확인창", §8 D7): 강제환불·지급 기록·기사 승인·정지·정리하기가 쓰는 하나의 틀.
// 제목 = 동작 + 대상 → 한 줄 결과 → 대상 정보 상자 → 돈의 흐름 상자 → 입력 → 빨간 경고 한 줄 → 확인 체크 → 켜는 방법 → 닫기·확정.
// 창 본체는 packages/ui DialogContent(경계 Tab 순환·aria-modal, DialogBody = 설명)를 그대로 쓴다.
// 확정 버튼은 위험도와 상관없이 초록 #007A43 한 가지다(빨간 채움 버튼 금지, §5 부딪히는 것 5번). 꺼진 버튼도 글자 대비 4.5:1 이상.
// 닫기 버튼이 따로 있으므로 오른쪽 위 X는 두지 않는다. Esc·바깥 누르기로도 닫힌다.
export function AdminConfirmDialog({
  open,
  title,
  lead,
  facts,
  flow,
  children,
  warning,
  check,
  confirmLabel,
  confirmDisabled = false,
  disabledHint,
  loading = false,
  initialFocus = 'close',
  onConfirm,
  onClose,
}: AdminConfirmDialogProps) {
  const checkId = useId();
  const disabled = loading || confirmDisabled;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="w-[480px] [word-break:keep-all]">
        <DialogHeader className="pr-4">
          <DialogTitle className="text-[17px] leading-[24px] font-bold">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            {lead && <p className="m-0 text-[15px] leading-[22px] text-foreground">{lead}</p>}
            {facts && facts.length > 0 && <ConfirmRows rows={facts} />}
            {flow && flow.length > 0 && <ConfirmRows rows={flow} numeric />}
            {children}
            {warning && (
              <p className="m-0 text-[14px] leading-[20px] font-semibold text-[var(--color-danger)]">
                {warning}
              </p>
            )}
            {check && (
              <label
                htmlFor={checkId}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] leading-[22px] text-foreground"
              >
                <input
                  id={checkId}
                  type="checkbox"
                  checked={check.checked}
                  disabled={loading}
                  onChange={(event) => check.onChange(event.currentTarget.checked)}
                  className="size-5 shrink-0 cursor-pointer accent-[#007A43]"
                  data-autofocus={initialFocus === 'check' ? true : undefined}
                />
                <span>{check.label}</span>
              </label>
            )}
            {confirmDisabled && !loading && disabledHint && (
              <p className="m-0 text-right text-[13px] leading-[18px] text-[var(--color-text-secondary)] max-sm:text-left">
                {disabledHint}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="plain"
                onClick={onClose}
                disabled={loading}
                className="h-10 rounded-[8px] px-4 text-[15px] focus-visible:outline-black max-sm:w-full"
                data-autofocus={initialFocus === 'close' ? true : undefined}
              >
                닫기
              </Button>
              <Button
                onClick={() => {
                  if (!disabled) onConfirm();
                }}
                disabled={disabled}
                className="h-10 rounded-[8px] bg-[#007A43] px-4 text-[15px] text-white hover:bg-[#006638] focus-visible:outline-black disabled:text-[#495057] max-sm:w-full"
              >
                {loading ? '처리 중…' : confirmLabel}
              </Button>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// 이름–값 줄. 줄 구분선은 상자 안쪽 전체 폭에 한 줄로 긋는다.
function ConfirmRows({ rows, numeric = false }: { rows: AdminConfirmRow[]; numeric?: boolean }) {
  return (
    <dl className="m-0 divide-y divide-rule rounded-[8px] bg-[#f4f7f5]">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-4 px-3 py-2 text-[14px] leading-[20px]"
        >
          <dt className="shrink-0 text-[var(--color-text-secondary)]">{row.label}</dt>
          <dd
            className={`m-0 min-w-0 text-right font-medium break-words text-foreground ${numeric ? 'tabular-nums' : ''}`}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
