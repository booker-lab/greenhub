'use client';

import type { Order } from '@greenhub/shared';
import { Paper, Stack, Text } from '@mantine/core';
import { isFeatureOn } from '@/lib/features';
import { Row } from './OrderRow';

// 팔도감 벤치마킹 비교 기능의 주문 정보: 포장할 때 볼 옵션, 쿠폰 할인, 선물 카드.
// 값이 없는 주문(기존 주문)에서는 아무것도 그리지 않는다.

export function OrderBenchmarkSection({ order }: { order: Order }) {
  const optionLines = isFeatureOn('option-sheet')
    ? (order.orderItems ?? []).filter((item) => (item.selectedOptions?.length ?? 0) > 0)
    : [];
  const discount = isFeatureOn('coupons') ? (order.discountAmount ?? 0) : 0;
  const gift = isFeatureOn('gift') ? order.gift : null;
  if (optionLines.length === 0 && discount <= 0 && !gift) return null;

  const label = {
    fontWeight: 'var(--fw-medium)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
  } as const;

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Stack gap={6}>
        {optionLines.length > 0 && (
          <>
            <Text style={label}>포장 옵션</Text>
            {optionLines.map((item) => (
              <Row
                key={`${item.productId}-${item.roundItemId ?? ''}`}
                label={item.productName}
                value={(item.selectedOptions ?? []).map((option) => option.choiceLabel).join(' · ')}
                highlight
              />
            ))}
          </>
        )}
        {discount > 0 && (
          <Row
            label={`쿠폰 할인${order.couponName ? ` (${order.couponName})` : ''}`}
            value={`−₩${discount.toLocaleString()}`}
          />
        )}
        {gift && (
          <>
            <Text style={label} mt={optionLines.length > 0 || discount > 0 ? 'xs' : 0}>
              선물 카드 (포장에 넣어 주세요)
            </Text>
            <Row label="받는 분" value={gift.recipientName} />
            <Row label="보내는 분" value={gift.senderName} />
            {gift.cardMessage && (
              <Text style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' }}>
                “{gift.cardMessage}”
              </Text>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
