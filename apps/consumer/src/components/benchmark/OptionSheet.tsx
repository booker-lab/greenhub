'use client';

import type { ProductOptionGroup } from '@greenhub/shared';
import { ActionIcon, Box, Button, Drawer, Group, Stack, Text } from '@mantine/core';
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
// 축하 문구는 미리 출력한 토퍼 선택지로 고른다. 자유 문구(포장 라벨)는 결제할 때 주문마다 한 번 받는다.
// 직접 출력한 화분처럼 재고에 연결된 선택지는 품절이면 고를 수 없고, 남은 수량보다 많이 담을 수 없다.

export interface OptionSelection {
  choiceIds: string[];
  label: string;
  priceDelta: number;
}

export function describeSelection(
  groups: ProductOptionGroup[],
  picked: Record<string, string>,
): OptionSelection | null {
  const parts: string[] = [];
  const choiceIds: string[] = [];
  let priceDelta = 0;
  for (const group of groups) {
    const choice = group.choices.find((c) => c.id === picked[group.id]);
    if (!choice) return null;
    parts.push(`${group.name}: ${choice.label}`);
    choiceIds.push(choice.id);
    priceDelta += choice.priceDelta;
  }
  return { choiceIds, label: parts.join(' · '), priceDelta };
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
  useEffect(() => {
    if (!opened) return;
    setPicked(Object.fromEntries(groups.map((g) => [g.id, g.choices[0]?.id ?? ''])));
    setQuantity(initialQuantity);
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
  const selection = overStock ? null : describeSelection(groups, picked);
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
              : (selection?.label ?? '옵션을 골라 주세요')}
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
