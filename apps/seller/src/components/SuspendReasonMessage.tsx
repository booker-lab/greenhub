'use client';

import { Stack, Text, TextInput } from '@mantine/core';

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
  return (
    <Stack gap="xs">
      <Text
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre-line',
        }}
      >
        {message}
      </Text>
      <TextInput
        label="사유 (선택)"
        description="행동 기록에 남아요. 손님 이름·전화번호는 적지 마세요."
        maxLength={SUSPEND_REASON_MAX_LENGTH}
        value={reason}
        onChange={(event) => onReasonChange(event.currentTarget.value)}
      />
    </Stack>
  );
}

/** 빈 사유는 보내지 않는다. */
export function normalizeSuspendReason(reason: string): string | undefined {
  const trimmed = reason.trim();
  return trimmed ? trimmed.slice(0, SUSPEND_REASON_MAX_LENGTH) : undefined;
}
