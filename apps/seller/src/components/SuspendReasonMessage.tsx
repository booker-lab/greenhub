'use client';

import { Field, FieldDescription, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { useId } from 'react';

// 계정 정지 확인창 본문. 사유는 선택이고 어드민 행동 기록에 남는다(API SuspendUserDto.reason, 최대 200자).
export const SUSPEND_REASON_MAX_LENGTH = 200;

export function SuspendReasonMessage({
  message,
  reason,
  onReasonChange,
}: {
  message: string;
  reason: string;
  onReasonChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5">
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
      <Field>
        <FieldLabel htmlFor={id}>사유 (선택)</FieldLabel>
        <FieldDescription>행동 기록에 남아요. 손님 이름·전화번호는 적지 마세요.</FieldDescription>
        <Input
          id={id}
          maxLength={SUSPEND_REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => onReasonChange(event.currentTarget.value)}
        />
      </Field>
    </div>
  );
}

/** 빈 사유는 보내지 않는다. */
export function normalizeSuspendReason(reason: string): string | undefined {
  const trimmed = reason.trim();
  return trimmed ? trimmed.slice(0, SUSPEND_REASON_MAX_LENGTH) : undefined;
}
