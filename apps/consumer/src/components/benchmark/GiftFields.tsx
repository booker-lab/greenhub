'use client';

import { GIFT_MESSAGE_MAX_LENGTH, type GiftInfo } from '@greenhub/shared';
import { Checkbox, Stack, Text, Textarea, TextInput } from '@mantine/core';

// 선물하기(gift). 받는 분 이름·보내는 분 이름·카드 문구를 요청사항과 따로 받는다.
// 받는 분 연락처는 아래 "배송 연락처"에 적는다(배송 안내 문자가 그 번호로 간다).

export interface GiftState extends GiftInfo {
  enabled: boolean;
}

export const EMPTY_GIFT: GiftState = { enabled: false, recipientName: '', senderName: '', cardMessage: '' };

/** 선물이 켜져 있고 이름 두 칸이 차 있으면 주문에 실을 값, 아니면 null. */
export function giftPayload(state: GiftState): GiftInfo | null {
  if (!state.enabled) return null;
  const recipientName = state.recipientName.trim();
  const senderName = state.senderName.trim();
  if (!recipientName || !senderName) return null;
  return { recipientName, senderName, cardMessage: state.cardMessage.trim() };
}

export default function GiftFields({ value, onChange }: { value: GiftState; onChange: (next: GiftState) => void }) {
  return (
    <Stack gap="sm" p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
      <Checkbox
        label="선물로 보내요"
        checked={value.enabled}
        onChange={(event) => onChange({ ...value, enabled: event.currentTarget.checked })}
      />
      {value.enabled && (
        <>
          <TextInput
            label="받는 분 이름"
            required
            maxLength={20}
            value={value.recipientName}
            onChange={(event) => onChange({ ...value, recipientName: event.target.value })}
          />
          <TextInput
            label="보내는 분 이름"
            required
            maxLength={20}
            value={value.senderName}
            onChange={(event) => onChange({ ...value, senderName: event.target.value })}
          />
          <Textarea
            label={`카드 문구 (선택, ${value.cardMessage.length}/${GIFT_MESSAGE_MAX_LENGTH})`}
            maxLength={GIFT_MESSAGE_MAX_LENGTH}
            placeholder="예) 개업을 축하합니다"
            value={value.cardMessage}
            onChange={(event) => onChange({ ...value, cardMessage: event.target.value })}
            autosize
            minRows={2}
          />
          <Text size="sm" c="var(--color-text-secondary)">
            배송 연락처에는 받는 분 휴대폰 번호를 적어 주세요. 배송 안내가 그 번호로 가요.
          </Text>
        </>
      )}
    </Stack>
  );
}
