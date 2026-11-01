'use client';

import type { SaleRoundItem } from '@greenhub/shared';
import { Button, ButtonLink } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import KakaoChannelCta from '@/components/benchmark/KakaoChannelCta';
import { resolveHomeStoreId } from '@/components/home-store-selection';
import { useRoundWishlist } from '@/hooks/useBenchmark';
import { useCart } from '@/hooks/useCart';
import { useProducts } from '@/hooks/useProducts';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';
import { cartAddFailureMessage, roundItemCartInput, roundProductHref } from '@/lib/round-quick-add';
import { fetchNeedsOptionChoice } from '@/lib/round-quick-add-options';

// ① 외형 유지(UI 교체 P5): Mantine Container sm(720px, 좌우 md 16·위 lg 20·아래 100)·Title h1(줄 높이 1.3)·
// Text(p, 크기 지정 없으면 md·줄 높이 1.55, sm은 줄 높이 1.45)·Stack·SimpleGrid(2열, 12)·Box(sm 12)·
// Button(radius xl, sm = 기본 36·light gray = secondary)과 같은 값.
const TITLE = 'm-0 text-[22px] leading-[1.3] font-extrabold';
const TEXT = 'm-0 p-0 leading-[1.55]';
const SMALL_TEXT = 'm-0 p-0 leading-[1.45]';
const SMALL = { fontSize: 'var(--font-size-sm)' } as const;

// 이번 회차 찜(wishlist, 벤치마킹 비교 기능). 이 브라우저에만, 이번 회차에만 남는다.
// 기능이 꺼져 있으면 없는 화면이다.
export default function WishlistPage() {
  if (!isFeatureOn('wishlist')) notFound();
  return <WishlistContent />;
}

function WishlistContent() {
  const { products, loading: productsLoading } = useProducts();
  const storeId = useMemo(() => resolveHomeStoreId(products, null), [products]);
  const { currentRound, loading: roundsLoading } = useSaleRounds(storeId);
  const wishlist = useRoundWishlist(currentRound?.id ?? null, true);
  const { addItem } = useCart();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const loading = productsLoading || roundsLoading;

  const items = (currentRound?.items ?? []).filter((item: SaleRoundItem) =>
    wishlist.ids.has(item.productId),
  );
  const canBuy = currentRound?.status === 'OPEN';

  return (
    <div className="mx-auto max-w-[720px] px-4 pt-5 pb-[100px]">
      <h1 className={TITLE}>이번 회차 찜</h1>
      <p
        className={`${SMALL_TEXT} mt-1 mb-4`}
        style={{ ...SMALL, color: 'var(--color-text-secondary)' }}
      >
        {currentRound ? `${currentRound.name} · ` : ''}이 휴대폰에만 남고, 회차가 끝나면 비워져요.
      </p>

      {!loading && items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10">
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-md)', color: 'var(--color-text-secondary)' }}
          >
            이번 회차에 찜한 꽃이 없어요.
          </p>
          <ButtonLink render={<Link href="/" />}>이번 회차 보러 가기</ButtonLink>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-3"
              style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}
            >
              <Link
                href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(item.roundId)}`}
                className={`${SMALL_TEXT} line-clamp-2 text-ellipsis`}
                style={{
                  ...SMALL,
                  fontWeight: 800,
                  color: 'var(--color-text)',
                  textDecoration: 'none',
                }}
              >
                {item.productNameSnapshot}
              </Link>
              <p className={`${SMALL_TEXT} mt-0.5`} style={{ ...SMALL, fontWeight: 800 }}>
                {item.roundPrice.toLocaleString('ko-KR')}원
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {canBuy && item.status === 'ACTIVE' && (
                  <Button
                    onClick={async () => {
                      // 옵션(화분 등)을 골라야 하는 상품은 담지 않고 상품 화면의 옵션 시트로 보낸다.
                      if (await fetchNeedsOptionChoice(item.productId)) {
                        router.push(roundProductHref(item));
                        return;
                      }
                      const result = addItem(roundItemCartInput(item));
                      setMessage(
                        result.ok
                          ? `${item.productNameSnapshot}을 담았어요`
                          : cartAddFailureMessage(result.reason),
                      );
                    }}
                  >
                    장바구니 담기
                  </Button>
                )}
                <Button variant="secondary" onClick={() => wishlist.toggle(item.productId)}>
                  찜 해제
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`${SMALL_TEXT} mt-3`}
          style={{ ...SMALL, color: 'var(--color-primary-dark)' }}
        >
          {message}
        </p>
      )}

      <div className="mt-8">
        <KakaoChannelCta
          title="다음 회차 소식은 카카오톡 채널로 받아 보세요"
          description="찜은 회차가 바뀌면 이어지지 않아요. 채널을 추가하면 새 회차가 열릴 때 알려드려요."
        />
      </div>
    </div>
  );
}
