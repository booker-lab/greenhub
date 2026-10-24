'use client';

import type { SaleRoundItem } from '@greenhub/shared';
import { Box, Button, Container, SimpleGrid, Stack, Text, Title } from '@mantine/core';
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

  const items = (currentRound?.items ?? []).filter((item: SaleRoundItem) => wishlist.ids.has(item.productId));
  const canBuy = currentRound?.status === 'OPEN';

  return (
    <Container size="sm" px="md" pt="lg" pb={100}>
      <Title order={1} style={{ fontSize: 22, fontWeight: 800 }}>
        이번 회차 찜
      </Title>
      <Text mt={4} mb="md" size="sm" c="var(--color-text-secondary)">
        {currentRound ? `${currentRound.name} · ` : ''}이 휴대폰에만 남고, 회차가 끝나면 비워져요.
      </Text>

      {!loading && items.length === 0 ? (
        <Stack align="center" py={40} gap="md">
          <Text c="var(--color-text-secondary)">이번 회차에 찜한 꽃이 없어요.</Text>
          <Button component={Link} href="/" radius="xl">
            이번 회차 보러 가기
          </Button>
        </Stack>
      ) : (
        <SimpleGrid cols={2} spacing={12}>
          {items.map((item) => (
            <Box key={item.id} p="sm" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
              <Text
                component={Link}
                href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(item.roundId)}`}
                fw={800}
                size="sm"
                lineClamp={2}
                style={{ color: 'var(--color-text)', textDecoration: 'none' }}
              >
                {item.productNameSnapshot}
              </Text>
              <Text size="sm" fw={800} mt={2}>
                {item.roundPrice.toLocaleString('ko-KR')}원
              </Text>
              <Stack gap={6} mt={8}>
                {canBuy && item.status === 'ACTIVE' && (
                  <Button
                    size="sm"
                    radius="xl"
                    onClick={async () => {
                      // 옵션(화분 등)을 골라야 하는 상품은 담지 않고 상품 화면의 옵션 시트로 보낸다.
                      if (await fetchNeedsOptionChoice(item.productId)) {
                        router.push(roundProductHref(item));
                        return;
                      }
                      const result = addItem(roundItemCartInput(item));
                      setMessage(
                        result.ok ? `${item.productNameSnapshot}을 담았어요` : cartAddFailureMessage(result.reason),
                      );
                    }}
                  >
                    장바구니 담기
                  </Button>
                )}
                <Button size="sm" radius="xl" variant="light" color="gray" onClick={() => wishlist.toggle(item.productId)}>
                  찜 해제
                </Button>
              </Stack>
            </Box>
          ))}
        </SimpleGrid>
      )}

      {message && (
        <Text role="status" size="sm" mt="sm" c="var(--color-primary-dark)">
          {message}
        </Text>
      )}

      <Box mt="xl">
        <KakaoChannelCta
          title="다음 회차 소식은 카카오톡 채널로 받아 보세요"
          description="찜은 회차가 바뀌면 이어지지 않아요. 채널을 추가하면 새 회차가 열릴 때 알려드려요."
        />
      </Box>
    </Container>
  );
}
