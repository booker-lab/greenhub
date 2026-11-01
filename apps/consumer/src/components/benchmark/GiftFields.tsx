'use client';

import { GIFT_MESSAGE_MAX_LENGTH, type GiftInfo, PACKAGE_LABEL_MAX_LENGTH } from '@greenhub/shared';
import { Checkbox } from '@greenhub/ui/components/checkbox';
import { FieldDescription, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { Textarea } from '@greenhub/ui/components/textarea';
import { type ReactNode, useId } from 'react';

// 선물하기(gift). 받는 분 / 보내는 분 / 카드 문구를 칸마다 나눠 받는다(요청사항과도 따로).
// 회차 주문의 배송 연락처는 원래 받는 분 휴대폰이므로, 선물을 켜면 그 칸을 "받는 분" 묶음 안으로 옮겨
// 같은 번호를 두 번 적지 않게 한다(결제 폼이 phoneSlot으로 넘긴다).
// 보내는 분 이름은 화분 포장 겉면 라벨로도 붙는다(포장 라벨과 같은 값, 20자까지).

export type GiftState = Omit<GiftInfo, 'recipientPhone'> & { enabled: boolean };

export const EMPTY_GIFT: GiftState = {
  enabled: false,
  recipientName: '',
  senderName: '',
  cardMessage: '',
};

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
    // Mantine Box p sm·Text sm(15px/1.45)·Stack gap xs 계산값
    <div
      className="p-3"
      style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)' }}
    >
      <p className="m-0 mb-2 p-0 text-sm font-extrabold">{title}</p>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

// Mantine TextInput(label·description·required) 계산값: 감싸는 상자 줄 높이 1.55, 라벨은 inline-block,
// 설명은 입력칸 위 5px. Field는 role="group"을 더해 접근성 트리가 바뀌므로 쓰지 않는다.
function GiftTextInput({
  label,
  description,
  required,
  maxLength,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  required?: boolean;
  maxLength: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="leading-[1.55]">
      <FieldLabel htmlFor={id} required={required} className="inline-block">
        {label}
      </FieldLabel>
      {description && (
        <FieldDescription id={descriptionId} className="m-0 mb-[5px] block p-0">
          {description}
        </FieldDescription>
      )}
      <Input
        id={id}
        required={required}
        maxLength={maxLength}
        value={value}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
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
  const cardMessageId = useId();
  return (
    // Mantine Stack gap sm·p md 계산값
    <div
      className="flex flex-col gap-3 p-4"
      style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}
    >
      <Checkbox
        label="선물로 보내요"
        checked={value.enabled}
        onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
      />
      {value.enabled && (
        <>
          <GiftBlock title="받는 분">
            <GiftTextInput
              label="이름"
              required
              maxLength={20}
              value={value.recipientName}
              onChange={(next) => onChange({ ...value, recipientName: next })}
            />
            {phoneSlot}
          </GiftBlock>
          <GiftBlock title="보내는 분">
            <GiftTextInput
              label="이름"
              description={
                senderIsPackageLabel ? '화분 포장 겉면 라벨로도 붙어요(무료).' : undefined
              }
              required
              maxLength={PACKAGE_LABEL_MAX_LENGTH}
              value={value.senderName}
              onChange={(next) => onChange({ ...value, senderName: next })}
            />
          </GiftBlock>
          <GiftBlock title="카드 문구 (선택)">
            <div className="leading-[1.55]">
              <FieldDescription
                id={`${cardMessageId}-description`}
                className="m-0 mb-[5px] block p-0"
              >
                {`${value.cardMessage.length}/${GIFT_MESSAGE_MAX_LENGTH}자`}
              </FieldDescription>
              <Textarea
                id={cardMessageId}
                aria-label="카드 문구"
                aria-describedby={`${cardMessageId}-description`}
                maxLength={GIFT_MESSAGE_MAX_LENGTH}
                placeholder="예) 개업을 축하합니다"
                value={value.cardMessage}
                onChange={(event) => onChange({ ...value, cardMessage: event.target.value })}
                autosize
                minRows={2}
              />
            </div>
          </GiftBlock>
        </>
      )}
    </div>
  );
}
