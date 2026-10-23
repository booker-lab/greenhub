'use client';

import { OPTION_TEXT_MAX_LENGTH, type ProductOptionGroup } from '@greenhub/shared';
import { ActionIcon, Box, Button, Drawer, Group, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import {
  choiceRemaining,
  choiceStockLabel,
  firstAvailableChoiceId,
  isChoiceSoldOut,
  maxQuantityFor,
  type OptionAvailabilityMap,
} from '@/lib/option-availability';

// 옵션 시트(option-sheet). 하단 고정 바의 장바구니·바로 구매를 누르면 아래에서 올라온다.
// 옵션 묶음마다 하나씩 고르고, 고른 조합의 가격과 수량을 보여준 뒤 담거나 바로 산다.
// 스티커 라벨·3D 토퍼처럼 문구가 필요한 선택지를 고르면 문구 칸이 열리고, 문구를 써야 담을 수 있다.
// 직접 출력한 화분처럼 재고에 연결된 선택지는 품절이면 고를 수 없고, 남은 수량보다 많이 담을 수 없다.

export interface OptionSelection {
  choiceIds: string[];
  label: string;
  priceDelta: number;
  /** 라벨·토퍼에 넣을 문구(문구가 필요한 선택지를 골랐을 때만) */
  text?: string;
}

/** 줄바꿈·앞뒤 공백을 정리한 문구. 서버(resolveSelectedOptions)와 같은 기준으로 한 줄로 만든다. */
export function normalizeOptionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function describeSelection(
  groups: ProductOptionGroup[],
  picked: Record<string, string>,
  rawText = '',
): OptionSelection | null {
  const parts: string[] = [];
  const choiceIds: string[] = [];
  let priceDelta = 0;
  let needsText = false;
  const text = normalizeOptionText(rawText);
  for (const group of groups) {
    const choice = group.choices.find((c) => c.id === picked[group.id]);
    if (!choice) return null;
    parts.push(`${group.name}: ${choice.label}${choice.needsText && text ? ` "${text}"` : ''}`);
    choiceIds.push(choice.id);
    priceDelta += choice.priceDelta;
    if (choice.needsText) needsText = true;
  }
  if (needsText && (!text || Array.from(text).length > OPTION_TEXT_MAX_LENGTH)) return null;
  return { choiceIds, label: parts.join(' · '), priceDelta, ...(needsText ? { text } : {}) };
}

export default function OptionSheet({
  opened,
  onClose,
  groups,
  basePrice,
  initialQuantity,
  intent,
  onConfirm,
  availability = null,
}: {
  opened: boolean;
  onClose: () => void;
  groups: ProductOptionGroup[];
  basePrice: number;
  initialQuantity: number;
  intent: 'cart' | 'buy';
  onConfirm: (selection: OptionSelection, quantity: number, intent: 'cart' | 'buy') => void;
  /** 선택지별 남은 수량. 모르면 null(제한 없이 그리고 서버가 주문 때 막는다). */
  availability?: OptionAvailabilityMap | null;
}) {
  // 첫 선택지(보통 기본 화분 같은 0원 선택지)를 미리 골라 두어 한 번에 담을 수 있게 한다.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(initialQuantity);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!opened) return;
    setPicked(Object.fromEntries(groups.map((g) => [g.id, g.choices[0]?.id ?? ''])));
    setQuantity(initialQuantity);
    setText('');
  }, [groups, initialQuantity, opened]);
  // 남은 수량은 시트가 열린 뒤 도착한다. 품절인 선택지를 골라 둔 묶음만 다른 선택지로 바꾼다.
  useEffect(() => {
    if (!opened || !availability) return;
    setPicked((current) =>
      Object.fromEntries(
        groups.map((g) => {
          const choiceId = current[g.id] ?? '';
          return [g.id, isChoiceSoldOut(availability, choiceId) ? firstAvailableChoiceId(g.choices, availability) : choiceId];
        }),
      ),
    );
  }, [availability, groups, opened]);

  const pickedChoiceIds = groups.map((group) => picked[group.id] ?? '');
  const maxQuantity = maxQuantityFor(availability, pickedChoiceIds);
  const overStock = quantity > maxQuantity;
  const selection = overStock ? null : describeSelection(groups, picked, text);
  const textChoice = groups
    .map((group) => group.choices.find((c) => c.id === picked[group.id]))
    .find((choice) => choice?.needsText);
  const unitPrice = basePrice + (selection?.priceDelta ?? 0);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="auto"
      radius="lg"
      title="옵션 고르기"
      styles={{
        title: { fontWeight: 800, fontSize: 'var(--font-size-lg)' },
        // 아래에서 올라오는 시트는 내용 높이만큼만 차지한다(최대 화면의 85%).
        content: { flex: '0 0 auto', height: 'auto', maxHeight: '85dvh' },
      }}
    >
      <Stack gap="lg" pb="md">
        {groups.map((group) => (
          <Box key={group.id} component="fieldset" style={{ border: 0, margin: 0, padding: 0 }}>
            <Text component="legend" fw={800} size="sm" mb={8}>
              {group.name}
            </Text>
            <Stack gap={6}>
              {group.choices.map((choice) => {
                const selected = picked[group.id] === choice.id;
                const soldOut = isChoiceSoldOut(availability, choice.id);
                const stockLabel = choiceStockLabel(choiceRemaining(availability, choice.id));
                return (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={soldOut}
                    onClick={() => setPicked((current) => ({ ...current, [group.id]: choice.id }))}
                    style={{
                      alignItems: 'center',
                      background: selected ? 'var(--color-primary-surface)' : 'var(--color-bg)',
                      border: selected ? '2px solid var(--color-primary)' : 'var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      color: soldOut ? 'var(--color-text-disabled)' : 'var(--color-text)',
                      cursor: soldOut ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      fontSize: 'var(--font-size-sm)',
                      gap: 8,
                      fontWeight: selected ? 800 : 400,
                      justifyContent: 'space-between',
                      minHeight: 'var(--touch-target)',
                      padding: '0 14px',
                      textAlign: 'left',
                    }}
                  >
                    <span>
                      {choice.label}
                      {stockLabel && (
                        <span
                          style={{
                            color: soldOut ? 'var(--color-text-disabled)' : 'var(--color-danger)',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 700,
                            marginLeft: 6,
                          }}
                        >
                          {stockLabel}
                        </span>
                      )}
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {choice.priceDelta > 0 ? `+${choice.priceDelta.toLocaleString()}원` : '추가 금액 없음'}
                    </span>
                  </button>
                );
              })}
            </Stack>
            {textChoice && group.choices.some((c) => c.id === textChoice.id) && (
              <TextInput
                mt={8}
                label={`${textChoice.label}에 넣을 문구`}
                description={`한 줄, ${OPTION_TEXT_MAX_LENGTH}자까지. 받는 분이 보는 문구예요.`}
                placeholder="예: 개업을 축하해요"
                value={text}
                maxLength={OPTION_TEXT_MAX_LENGTH}
                onChange={(event) => setText(event.currentTarget.value)}
                rightSection={
                  <Text size="xs" c="var(--color-text-disabled)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {Array.from(text).length}/{OPTION_TEXT_MAX_LENGTH}
                  </Text>
                }
                rightSectionWidth={52}
              />
            )}
          </Box>
        ))}

        <Group justify="space-between" wrap="nowrap">
          <Text fw={800} size="sm">
            수량
          </Text>
          <Group gap={4} wrap="nowrap" style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-full)' }}>
            <ActionIcon size={40} variant="subtle" color="dark" radius="xl" aria-label="수량 줄이기" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
              −
            </ActionIcon>
            <Text w={32} ta="center" fw={800} aria-live="polite" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {quantity}
            </Text>
            <ActionIcon size={40} variant="subtle" color="dark" radius="xl" aria-label="수량 늘리기" disabled={quantity >= maxQuantity} onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}>
              +
            </ActionIcon>
          </Group>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="var(--color-text-secondary)">
            {overStock
              ? maxQuantity > 0
                ? `고른 옵션은 ${maxQuantity}개까지 담을 수 있어요`
                : '고른 옵션이 품절이에요'
              : (selection?.label ?? (textChoice ? '문구를 적어 주세요' : '옵션을 골라 주세요'))}
          </Text>
          <Text fw={800} size="lg" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {(unitPrice * quantity).toLocaleString()}원
          </Text>
        </Group>

        <Button
          size="lg"
          radius="xl"
          disabled={!selection}
          onClick={() => selection && onConfirm(selection, quantity, intent)}
        >
          {intent === 'cart' ? '장바구니 담기' : '바로 구매'}
        </Button>
      </Stack>
    </Drawer>
  );
}
