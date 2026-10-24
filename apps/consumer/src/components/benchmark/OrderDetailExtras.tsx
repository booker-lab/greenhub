'use client';

import { Box, Button, Paper, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { useCart } from '@/hooks/useCart';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';
import { roundItemCartInput } from '@/lib/round-quick-add';
import { fetchNeedsOptionChoice } from '@/lib/round-quick-add-options';
import type { OrderBenchmarkExtras } from '@/app/mypage/orders/[id]/_detail';
import OrderReviews from './OrderReviews';

// MY 주문 상세의 벤치마킹 비교 기능: 옵션·선물 표시, 후기 쓰기, 다시 주문하기, 관리 안내.

const REVIEWABLE = new Set(['DELIVERED', 'PICKED_UP', 'REVIEWED']);

export default function OrderDetailExtras({
  orderId,
  storeId,
  status,
  isRoundOrder,
  items,
  extras,
}: {
  orderId: string;
  storeId: string;
  status: string;
  isRoundOrder: boolean;
  items: Array<{ id: string; productName: string }>;
  extras: OrderBenchmarkExtras;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const token = session?.user?.accessToken ?? null;
  const { addItem } = useCart();
  const reviewsOn = isFeatureOn('reviews') && REVIEWABLE.has(status);
  const reorderOn = isFeatureOn('reorder') && isRoundOrder;
  const { currentRound } = useSaleRounds(reorderOn ? storeId : null);
  const [reorderMessage, setReorderMessage] = useState<string | null>(null);

  const nameOf = (id: string) => items.find((item) => item.id === id)?.productName ?? '상품';
  const optionLines = isFeatureOn('option-sheet')
    ? extras.items.filter((item) => item.optionLabel)
    : [];
  const showGift = isFeatureOn('gift') && extras.gift;
  const reorderable =
    reorderOn && currentRound?.status === 'OPEN'
      ? extras.items
          .map((item) => ({
            item,
            roundItem: currentRound.items.find(
              (candidate) =>
                candidate.productId === item.productId && candidate.status === 'ACTIVE',
            ),
          }))
          .filter((entry) => entry.roundItem)
      : [];

  if (
    optionLines.length === 0 &&
    !showGift &&
    !reviewsOn &&
    !reorderOn &&
    !(isFeatureOn('care-guide') && REVIEWABLE.has(status))
  ) {
    return null;
  }

  return (
    <Stack gap="md" mb="lg">
      {(optionLines.length > 0 || showGift) && (
        <Paper p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
          <Stack gap={4}>
            {optionLines.map((item) => (
              <Text key={item.id} size="sm">
                {nameOf(item.id)} · {item.optionLabel}
              </Text>
            ))}
            {showGift && extras.gift && (
              <Stack gap={2} mt={optionLines.length > 0 ? 6 : 0}>
                <Text size="sm" fw={700}>
                  선물
                </Text>
                <Text size="sm">받는 분 · {extras.gift.recipientName}</Text>
                {extras.gift.recipientPhone && (
                  <Text size="sm">받는 분 연락처 · {extras.gift.recipientPhone}</Text>
                )}
                <Text size="sm">보내는 분 · {extras.gift.senderName}</Text>
                {extras.gift.cardMessage && (
                  <Text size="sm">카드 문구 · "{extras.gift.cardMessage}"</Text>
                )}
              </Stack>
            )}
          </Stack>
        </Paper>
      )}

      {reviewsOn && token && (
        <OrderReviews
          orderId={orderId}
          token={token}
          items={extras.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            productName: nameOf(item.id),
          }))}
        />
      )}

      {isFeatureOn('care-guide') && REVIEWABLE.has(status) && (
        <Paper
          p="md"
          style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}
        >
          <Text fw={800} size="sm" c="var(--color-primary-dark)">
            받은 꽃 관리 안내
          </Text>
          <Stack gap={2} mt={4}>
            {extras.items.map((item) => (
              <Link
                key={item.id}
                href={`/products/${encodeURIComponent(item.productId)}#care-title`}
                style={{ color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}
              >
                {nameOf(item.id)} 관리법 보기 →
              </Link>
            ))}
          </Stack>
        </Paper>
      )}

      {reorderOn && (
        <Box>
          <Button
            fullWidth
            variant="outline"
            radius="xl"
            size="lg"
            disabled={reorderable.length === 0}
            onClick={async () => {
              // 옵션(화분 등)을 골라야 하는 상품은 옵션 없이 담지 않는다. 상품 화면에서 골라 담게 안내한다.
              const needsOptions = await Promise.all(
                reorderable.map((entry) => fetchNeedsOptionChoice(entry.roundItem!.productId)),
              );
              let added = 0;
              let skipped = 0;
              let failure: string | null = null;
              reorderable.forEach((entry, index) => {
                if (needsOptions[index]) {
                  skipped += 1;
                  return;
                }
                const result = addItem(roundItemCartInput(entry.roundItem!, entry.item.quantity));
                if (result.ok) added += 1;
                else failure = '장바구니에 다른 회차 상품이 있어 담지 못했어요.';
              });
              if (added > 0 && skipped === 0) {
                router.push('/cart');
                return;
              }
              if (skipped > 0) {
                setReorderMessage(
                  `${added > 0 ? `${added}개 상품을 담았어요. ` : ''}화분 등 옵션을 골라야 하는 상품 ${skipped}개는 상품 화면에서 옵션을 골라 담아 주세요.`,
                );
                return;
              }
              setReorderMessage(failure ?? '담을 상품이 없어요.');
            }}
          >
            {reorderable.length > 0
              ? `이번 회차로 다시 주문하기 (${reorderable.length}개 상품)`
              : '이번 회차에는 같은 상품이 없어요'}
          </Button>
          {reorderMessage && (
            <Text role="alert" size="sm" mt={6} c="var(--color-danger)">
              {reorderMessage}
            </Text>
          )}
        </Box>
      )}
    </Stack>
  );
}
