'use client';

import { REVIEW_TEXT_MAX_LENGTH, type ReviewPublic } from '@greenhub/shared';
import { Box, Button, Group, Paper, Stack, Text, Textarea } from '@mantine/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useCart } from '@/hooks/useCart';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { BenchmarkApiError, createReview, fetchOrderReviews } from '@/lib/benchmark-api';
import { isFeatureOn } from '@/lib/features';
import { roundItemCartInput } from '@/lib/round-quick-add';
import type { OrderBenchmarkExtras } from '@/app/mypage/orders/[id]/_detail';

// MY 주문 상세의 벤치마킹 비교 기능: 옵션·쿠폰·선물 표시, 후기 쓰기, 다시 주문하기, 관리 안내.

const REVIEWABLE = new Set(['DELIVERED', 'PICKED_UP', 'REVIEWED']);

function ReviewForm({
  orderId,
  productId,
  productName,
  token,
  onDone,
}: {
  orderId: string;
  productId: string;
  productName: string;
  token: string;
  onDone: (review: ReviewPublic) => void;
}) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  return (
    <Stack gap={6} mt="xs">
      <Group gap={2} role="radiogroup" aria-label={`${productName} 별점`}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value}점`}
            onClick={() => setRating(value)}
            style={{
              background: 'transparent',
              border: 0,
              color: value <= rating ? '#F5A524' : 'var(--color-border)',
              cursor: 'pointer',
              fontSize: 26,
              height: 'var(--touch-target)',
              padding: 0,
              width: 36,
            }}
          >
            ★
          </button>
        ))}
      </Group>
      <Textarea
        aria-label={`${productName} 후기`}
        placeholder="꽃 상태, 크기, 포장은 어땠나요?"
        maxLength={REVIEW_TEXT_MAX_LENGTH}
        autosize
        minRows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {error && (
        <Text role="alert" size="sm" c="var(--color-danger)">
          {error}
        </Text>
      )}
      <Button
        radius="xl"
        loading={sending}
        disabled={text.trim().length < 5}
        onClick={async () => {
          setSending(true);
          setError(null);
          try {
            onDone(await createReview(orderId, token, { productId, rating, text: text.trim() }));
          } catch (e) {
            setError(e instanceof BenchmarkApiError ? e.message : '후기를 남기지 못했어요.');
          } finally {
            setSending(false);
          }
        }}
      >
        후기 남기기
      </Button>
    </Stack>
  );
}

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
  const [written, setWritten] = useState<Record<string, ReviewPublic>>({});
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [reorderMessage, setReorderMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!reviewsOn || !token) return;
    let active = true;
    fetchOrderReviews(orderId, token)
      .then((list) => {
        if (active) setWritten(Object.fromEntries(list.map((review) => [review.productId, review])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orderId, reviewsOn, token]);

  const nameOf = (id: string) => items.find((item) => item.id === id)?.productName ?? '상품';
  const optionLines = isFeatureOn('option-sheet') ? extras.items.filter((item) => item.optionLabel) : [];
  const showMoney = extras.discountAmount > 0 || (isFeatureOn('gift') && extras.gift);
  const reorderable =
    reorderOn && currentRound?.status === 'OPEN'
      ? extras.items
          .map((item) => ({
            item,
            roundItem: currentRound.items.find(
              (candidate) => candidate.productId === item.productId && candidate.status === 'ACTIVE',
            ),
          }))
          .filter((entry) => entry.roundItem)
      : [];

  if (
    optionLines.length === 0 &&
    !showMoney &&
    !reviewsOn &&
    !reorderOn &&
    !(isFeatureOn('care-guide') && REVIEWABLE.has(status))
  ) {
    return null;
  }

  return (
    <Stack gap="md" mb="lg">
      {(optionLines.length > 0 || showMoney) && (
        <Paper p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
          <Stack gap={4}>
            {optionLines.map((item) => (
              <Text key={item.id} size="sm">
                {nameOf(item.id)} · {item.optionLabel}
              </Text>
            ))}
            {extras.discountAmount > 0 && (
              <Text size="sm" c="var(--color-primary-dark)" fw={700}>
                쿠폰 할인{extras.couponName ? ` (${extras.couponName})` : ''} −
                {extras.discountAmount.toLocaleString('ko-KR')}원
              </Text>
            )}
            {isFeatureOn('gift') && extras.gift && (
              <Text size="sm">
                선물 · {extras.gift.senderName} → {extras.gift.recipientName}
                {extras.gift.cardMessage ? ` · "${extras.gift.cardMessage}"` : ''}
              </Text>
            )}
          </Stack>
        </Paper>
      )}

      {reviewsOn && token && (
        <Paper p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
          <Text fw={800} mb="xs">
            후기
          </Text>
          <Stack gap="sm">
            {extras.items.map((item) => {
              const review = written[item.productId];
              return (
                <Box key={item.id}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={700}>
                      {nameOf(item.id)}
                    </Text>
                    {review ? (
                      <Text size="sm" c="var(--color-primary-dark)" fw={700}>
                        ★ {review.rating} 남김
                      </Text>
                    ) : (
                      <Button
                        size="compact-sm"
                        variant="light"
                        radius="xl"
                        onClick={() => setOpenForm(openForm === item.productId ? null : item.productId)}
                      >
                        후기 쓰기
                      </Button>
                    )}
                  </Group>
                  {!review && openForm === item.productId && (
                    <ReviewForm
                      orderId={orderId}
                      productId={item.productId}
                      productName={nameOf(item.id)}
                      token={token}
                      onDone={(created) => {
                        setWritten((current) => ({ ...current, [item.productId]: created }));
                        setOpenForm(null);
                      }}
                    />
                  )}
                </Box>
              );
            })}
          </Stack>
        </Paper>
      )}

      {isFeatureOn('care-guide') && REVIEWABLE.has(status) && (
        <Paper p="md" style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}>
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
            onClick={() => {
              let added = 0;
              let failure: string | null = null;
              for (const entry of reorderable) {
                const result = addItem(roundItemCartInput(entry.roundItem!, entry.item.quantity));
                if (result.ok) added += 1;
                else failure = '장바구니에 다른 회차 상품이 있어 담지 못했어요.';
              }
              if (added > 0) router.push('/cart');
              else setReorderMessage(failure ?? '담을 상품이 없어요.');
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
