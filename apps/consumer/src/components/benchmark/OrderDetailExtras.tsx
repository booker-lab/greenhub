'use client';

import { Button } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import type { OrderBenchmarkExtras } from '@/app/mypage/orders/[id]/_detail';
import { useCart } from '@/hooks/useCart';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';
import { roundItemCartInput } from '@/lib/round-quick-add';
import { fetchNeedsOptionChoice } from '@/lib/round-quick-add-options';
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
  // 포장 라벨: 선물이면 보내는 분 이름과 같으므로 선물 칸에서 함께 알린다.
  const packageLabel = isFeatureOn('option-sheet') && !showGift ? extras.packageLabel : null;
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
    !packageLabel &&
    !reviewsOn &&
    !reorderOn &&
    !(isFeatureOn('care-guide') && REVIEWABLE.has(status))
  ) {
    return null;
  }

  return (
    // ① 외형 유지(UI 교체 P5): Mantine Stack(gap md·mb lg)·Paper(p md)·Text sm·Button(outline lg) 값.
    <div className="mb-5 flex flex-col gap-4">
      {(optionLines.length > 0 || showGift || packageLabel) && (
        <div className="p-4" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
          <div className="flex flex-col gap-1">
            {optionLines.map((item) => (
              <p key={item.id} className="m-0 text-sm">
                {nameOf(item.id)} · {item.optionLabel}
              </p>
            ))}
            {packageLabel && <p className="m-0 text-sm">포장 라벨 · {packageLabel}</p>}
            {showGift && extras.gift && (
              <div
                className={`flex flex-col gap-0.5 ${optionLines.length > 0 ? 'mt-1.5' : 'mt-0'}`}
              >
                <p className="m-0 text-sm font-bold">선물</p>
                <p className="m-0 text-sm">받는 분 · {extras.gift.recipientName}</p>
                {extras.gift.recipientPhone && (
                  <p className="m-0 text-sm">받는 분 연락처 · {extras.gift.recipientPhone}</p>
                )}
                <p className="m-0 text-sm">
                  보내는 분 · {extras.gift.senderName}
                  {isFeatureOn('option-sheet') && extras.packageLabel
                    ? ' (포장 라벨로 붙여요)'
                    : ''}
                </p>
                {extras.gift.cardMessage && (
                  <p className="m-0 text-sm">카드 문구 · "{extras.gift.cardMessage}"</p>
                )}
              </div>
            )}
          </div>
        </div>
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
        <div
          className="p-4"
          style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}
        >
          <p className="m-0 text-sm font-extrabold" style={{ color: 'var(--color-primary-dark)' }}>
            받은 꽃 관리 안내
          </p>
          <div className="mt-1 flex flex-col gap-0.5">
            {extras.items.map((item) => (
              <Link
                key={item.id}
                href={`/products/${encodeURIComponent(item.productId)}#care-title`}
                style={{ color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}
              >
                {nameOf(item.id)} 관리법 보기 →
              </Link>
            ))}
          </div>
        </div>
      )}

      {reorderOn && (
        <div>
          <Button
            className="w-full"
            variant="outline"
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
            <p role="alert" className="m-0 mt-1.5 text-sm" style={{ color: 'var(--color-danger)' }}>
              {reorderMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
