'use client';

import type { SaleRoundItem } from '@greenhub/shared';
import { Box, Group, Text } from '@mantine/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useState } from 'react';
import { type CartItem, useCart } from '@/hooks/useCart';
import type { PublicSaleRound } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';
import { cartAddFailureMessage, roundItemCartInput, roundProductHref } from '@/lib/round-quick-add';
import { fetchNeedsOptionChoice } from '@/lib/round-quick-add-options';
import { formatRoundTime } from '@/lib/round-schedule-label';

// 장바구니의 벤치마킹 비교 기능(도착 시각·배송 지역 미리 확인·추가 제안).

/** 결제 마감 안내 아래 도착 시각(arrival-everywhere). */
export function CartArrivalLine({ round }: { round: PublicSaleRound }) {
  if (!isFeatureOn('arrival-everywhere')) return null;
  const arrival = formatRoundTime(round.schedule.deliveryEndAt);
  if (!arrival) return null;
  return (
    <Box
      px="md"
      py="sm"
      style={{
        background: 'var(--color-primary-surface)',
        borderRadius: 'var(--radius)',
        color: 'var(--color-primary-dark)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--fw-bold)',
      }}
    >
      {arrival}까지 문 앞에 도착해요
    </Box>
  );
}

/** 이천시 주소로 시작하는지(결제 화면 isIcheonDeliveryAddress와 같은 기준). */
export function isIcheonAddress(value: string): boolean {
  return /^(?:(?:경기도|경기)\s+)?이천시(?:\s|$)/.test(value.trim());
}

/** 결제 전에 배송 지역을 미리 확인(icheon-precheck). 주소 찾기 창으로 고른 주소만 판정한다. */
export function IcheonPrecheck() {
  const [result, setResult] = useState<{ address: string; ok: boolean } | null>(null);
  if (!isFeatureOn('icheon-precheck')) return null;
  return (
    <Box p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
      <Script src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js" strategy="lazyOnload" />
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Box style={{ minWidth: 0 }}>
          <Text size="sm" fw={800}>
            우리 집도 배송되나요?
          </Text>
          <Text size="sm" c="var(--color-text-secondary)">
            경기도 이천시만 직접 배송해요. 결제 전에 주소로 확인해 보세요.
          </Text>
        </Box>
        <button
          type="button"
          onClick={() => {
            const daum = (window as unknown as { daum?: Window['daum'] }).daum;
            if (!daum?.Postcode) return;
            new daum.Postcode({
              oncomplete(data) {
                setResult({ address: data.address, ok: isIcheonAddress(data.address) });
              },
            }).open();
          }}
          style={{
            background: 'var(--color-surface-muted)',
            border: 0,
            borderRadius: 'var(--radius-full)',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 'var(--font-size-sm)',
            fontWeight: 800,
            minHeight: 'var(--touch-target)',
            padding: '0 14px',
          }}
        >
          주소로 확인
        </button>
      </Group>
      {result && (
        <Text
          role="status"
          mt="sm"
          size="sm"
          fw={700}
          c={result.ok ? 'var(--color-primary-dark)' : 'var(--color-danger)'}
        >
          {result.ok
            ? `${result.address} — 배송할 수 있어요.`
            : `${result.address} — 이천시 밖이라 이번 회차는 배송할 수 없어요.`}
        </Text>
      )}
    </Box>
  );
}

/** 장바구니에 없는 이번 회차 상품 제안(cart-upsell). */
export function CartUpsell({ round, items }: { round: PublicSaleRound; items: CartItem[] }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  if (!isFeatureOn('cart-upsell') || round.status !== 'OPEN') return null;
  const inCart = new Set(items.map((item) => item.roundItemId));
  const candidates = round.items
    .filter((item: SaleRoundItem) => item.status === 'ACTIVE' && !inCart.has(item.id))
    .slice(0, 4);
  if (candidates.length === 0) return null;
  return (
    <Box component="section" aria-labelledby="upsell-title" mb="lg">
      <Text id="upsell-title" fw={800} size="md" mb="sm">
        이번 회차 다른 꽃도 함께 받아 보세요
      </Text>
      <Box style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {candidates.map((item) => (
          <Box
            key={item.id}
            p="sm"
            style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)', flex: '0 0 150px' }}
          >
            <Text
              component={Link}
              href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(round.id)}`}
              size="sm"
              fw={700}
              lineClamp={2}
              style={{ color: 'var(--color-text)', textDecoration: 'none' }}
            >
              {item.productNameSnapshot}
            </Text>
            <Text size="sm" fw={800} mt={2}>
              {item.roundPrice.toLocaleString()}원
            </Text>
            <button
              type="button"
              onClick={async () => {
                // 옵션(화분 등)을 골라야 하는 상품은 담지 않고 상품 화면의 옵션 시트로 보낸다.
                if (await fetchNeedsOptionChoice(item.productId)) {
                  router.push(roundProductHref(item));
                  return;
                }
                const result = addItem(roundItemCartInput(item));
                setMessage(result.ok ? `${item.productNameSnapshot}을 담았어요` : cartAddFailureMessage(result.reason));
              }}
              style={{
                background: 'var(--color-bg)',
                border: 'var(--border)',
                borderRadius: 'var(--radius-full)',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 800,
                marginTop: 8,
                minHeight: 'var(--touch-target)',
                width: '100%',
              }}
            >
              + 담기
            </button>
          </Box>
        ))}
      </Box>
      {message && (
        <Text role="status" size="sm" mt={6} c="var(--color-primary-dark)">
          {message}
        </Text>
      )}
    </Box>
  );
}
