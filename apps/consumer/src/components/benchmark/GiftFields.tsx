'use client';

import { GIFT_MESSAGE_MAX_LENGTH, type GiftInfo, PACKAGE_LABEL_MAX_LENGTH } from '@greenhub/shared';
import { Box, Checkbox, Stack, Text, Textarea, TextInput } from '@mantine/core';
import type { ReactNode } from 'react';

// 선물하기(gift). 받는 분 / 보내는 분 / 카드 문구를 칸마다 나눠 받는다(요청사항과도 따로).
// 회차 주문의 배송 연락처는 원래 받는 분 휴대폰이므로, 선물을 켜면 그 칸을 "받는 분" 묶음 안으로 옮겨
// 같은 번호를 두 번 적지 않게 한다(결제 폼이 phoneSlot으로 넘긴다).
// 보내는 분 이름은 화분 포장 겉면 라벨로도 붙는다(포장 라벨과 같은 값, 20자까지).

export type GiftState = Omit<GiftInfo, 'recipientPhone'> & { enabled: boolean };

export const EMPTY_GIFT: GiftState = { enabled: false, recipientName: '', senderName: '', cardMessage: '' };

/** 선물이 켜져 있고 이름 두 칸이 차 있으면 주문에 실을 값, 아니면 null. 받는 분 휴대폰은 배송 연락처다. */
export function giftPayload(state: GiftState, deliveryPhone: string): GiftInfo | null {
  if (!state.enabled) return null;
  const recipientName = state.recipientName.trim();
  const senderName = state.senderName.trim();
  if (!recipientName || !senderName) return null;
  return {
    recipientName,
    recipientPhone: deliveryPhone.trim(),
    senderName,
    cardMessage: state.cardMessage.trim(),
  };
}

function GiftBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box p="sm" style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)' }}>
      <Text fw={800} size="sm" mb={8}>
        {title}
      </Text>
      <Stack gap="xs">{children}</Stack>
    </Box>
  );
}

export default function GiftFields({
  value,
  onChange,
  phoneSlot,
  senderIsPackageLabel = false,
}: {
  value: GiftState;
  onChange: (next: GiftState) => void;
  /** 선물이 켜졌을 때 "받는 분" 묶음에 넣을 배송 연락처 입력칸 */
  phoneSlot?: ReactNode;
  /** 보내는 분 이름이 포장 라벨로 붙는다고 알린다(옵션 시트가 켜졌을 때) */
  senderIsPackageLabel?: boolean;
}) {
  return (
    <Stack gap="sm" p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
      <Checkbox
        label="선물로 보내요"
        checked={value.enabled}
        onChange={(event) => onChange({ ...value, enabled: event.currentTarget.checked })}
      />
      {value.enabled && (
        <>
          <GiftBlock title="받는 분">
            <TextInput
              label="이름"
              required
              maxLength={20}
              value={value.recipientName}
              onChange={(event) => onChange({ ...value, recipientName: event.target.value })}
            />
            {phoneSlot}
          </GiftBlock>
          <GiftBlock title="보내는 분">
            <TextInput
              label="이름"
              description={senderIsPackageLabel ? '화분 포장 겉면 라벨로도 붙어요(무료).' : undefined}
              required
              maxLength={PACKAGE_LABEL_MAX_LENGTH}
              value={value.senderName}
              onChange={(event) => onChange({ ...value, senderName: event.target.value })}
            />
          </GiftBlock>
          <GiftBlock title="카드 문구 (선택)">
            <Textarea
              aria-label="카드 문구"
              description={`${value.cardMessage.length}/${GIFT_MESSAGE_MAX_LENGTH}자`}
              maxLength={GIFT_MESSAGE_MAX_LENGTH}
              placeholder="예) 개업을 축하합니다"
              value={value.cardMessage}
              onChange={(event) => onChange({ ...value, cardMessage: event.target.value })}
              autosize
              minRows={2}
            />
          </GiftBlock>
        </>
      )}
    </Stack>
  );
}
