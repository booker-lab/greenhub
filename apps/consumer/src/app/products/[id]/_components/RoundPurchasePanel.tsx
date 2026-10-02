import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { Box, Group, Stack, Text, Title } from '@mantine/core';
import { formatOrderCloseLabel, formatRoundTime } from '@/lib/round-schedule-label';

interface RoundPurchasePanelProps {
  round: SaleRound;
  item: SaleRoundItem;
  state: 'current' | 'closed';
  isPurchasable: boolean;
}

// 상품 상세 사진 바로 아래의 회차 요약(디자인 기준 §5): 상태 태그 → 상품명·회차 가격 → 배송 흐름.
// 상품명은 회차에 올린 시점의 이름(productNameSnapshot)을 쓴다. 필수 고지는 아래 RoundPurchaseNotices.
export default function RoundPurchasePanel({
  round,
  item,
  state,
  isPurchasable,
}: RoundPurchasePanelProps) {
  const closed = state === 'closed';
  const statusLabel = isPurchasable ? '구매 가능' : closed ? '판매 마감' : '판매 예정';
  const notOpenYet = !closed && round.status === 'SCHEDULED';
  const statusTone = isPurchasable
    ? { background: 'var(--color-primary-surface)', color: 'var(--color-primary-dark)' }
    : closed
      ? { background: 'var(--color-surface-muted)', color: 'var(--color-text-secondary)' }
      : { background: 'var(--color-deadline-surface)', color: 'var(--color-deadline-text)' };

  const steps = [
    notOpenYet
      ? { label: '주문 시작', value: formatRoundTime(round.schedule.orderOpenAt) ?? '일정 확인 중' }
      : null,
    { label: '주문 마감', value: formatOrderCloseLabel(round.schedule.orderCloseAt) },
    { label: '새벽 경매', value: formatRoundTime(round.schedule.auctionAt) ?? '일정 확인 중' },
    {
      label: '문 앞 도착',
      value: `${formatRoundTime(round.schedule.deliveryEndAt) ?? '화요일 오전 9시'}까지`,
    },
  ].filter((step): step is { label: string; value: string } => step !== null);

  return (
    <Box
      component="section"
      px="md"
      pt="lg"
      pb="xs"
      aria-labelledby="round-purchase-title"
      data-round-state={state}
      data-round-purchasable={isPurchasable}
    >
      <Group gap={8} wrap="nowrap">
        <span
          style={{
            ...statusTone,
            borderRadius: 'var(--radius-tag)',
            flexShrink: 0,
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--fw-bold)',
            padding: '2px 8px',
          }}
        >
          {statusLabel}
        </span>
        <Text
          id="round-purchase-title"
          truncate
          style={{
            color: 'var(--color-primary-dark)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          {closed ? '마감된 회차' : notOpenYet ? '판매 예정 회차' : '이번 주 판매 회차'} ·{' '}
          {round.name}
        </Text>
      </Group>

      <Title
        order={1}
        mt={10}
        style={{
          color: 'var(--color-text)',
          fontSize: 22,
          fontWeight: 'var(--fw-extrabold)',
          letterSpacing: '-0.01em',
          lineHeight: 1.3,
        }}
      >
        {item.productNameSnapshot}
      </Title>
      <Group gap={8} align="baseline" mt={6}>
        <Text size="sm" c="var(--color-text-secondary)">
          회차 가격
        </Text>
        <Text
          style={{
            color: closed ? 'var(--color-text-secondary)' : 'var(--color-text)',
            fontSize: 24,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 'var(--fw-extrabold)',
          }}
        >
          {item.roundPrice.toLocaleString('ko-KR')}원
        </Text>
      </Group>
      <Text size="sm" c="var(--color-text-secondary)">
        이 회차 주문에 적용되는 결제 기준 가격입니다.
      </Text>

      <Stack
        component="ol"
        gap={10}
        mt="md"
        p="md"
        aria-label="주문부터 배송까지"
        style={{
          background: closed ? 'var(--color-surface-muted)' : 'var(--color-primary-surface)',
          borderRadius: 'var(--radius)',
          listStyle: 'none',
          marginBottom: 0,
        }}
      >
        {steps.map((step) => (
          <Group
            key={step.label}
            component="li"
            justify="space-between"
            align="flex-start"
            wrap="nowrap"
            gap="sm"
          >
            <Group gap={8} wrap="nowrap">
              <span
                aria-hidden
                style={{
                  background: closed ? 'var(--color-text-disabled)' : 'var(--color-primary)',
                  borderRadius: 'var(--radius-full)',
                  display: 'inline-block',
                  flexShrink: 0,
                  height: 8,
                  width: 8,
                }}
              />
              <Text size="sm" fw="var(--fw-bold)" c="var(--color-text)">
                {step.label}
              </Text>
            </Group>
            <Text
              size="sm"
              ta="right"
              c="var(--color-text-secondary)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {step.value}
            </Text>
          </Group>
        ))}
      </Stack>
    </Box>
  );
}

/** 회차 상품의 필수 고지(배송 지역·기상 연기·청약철회). 상품 설명 아래, 구매 버튼 위에 둔다. */
export function RoundPurchaseNotices() {
  return (
    <Box component="section" aria-label="회차 배송·청약철회 안내" px="md" pb="xs">
      <Stack gap={4}>
        <Text size="sm" fw="var(--fw-extrabold)" c="var(--color-text)">
          경기 이천 직접배송
        </Text>
        <Text size="sm" c="var(--color-text-secondary)">
          경기도 이천시 직접배송만 제공하며, 화요일 오전 9시까지 문 앞 배송합니다.
        </Text>
      </Stack>

      <Box
        mt="md"
        p="md"
        style={{ background: 'var(--color-deadline-surface)', borderRadius: 'var(--radius)' }}
      >
        <Text size="sm" fw="var(--fw-bold)" c="var(--color-deadline-text)" mb={4}>
          기상 상황에 따른 배송 연기
        </Text>
        <Text size="sm" c="var(--color-text-secondary)" style={{ lineHeight: 1.6 }}>
          안전한 배송이 어려운 기상 상황에는 배송이 연기될 수 있습니다. 판매자 책임으로 재배송비
          없이 새 배송 일정을 안내합니다.
        </Text>
      </Box>

      <Box mt="md">
        <Text size="sm" fw="var(--fw-bold)" mb={4}>
          청약철회 제한 안내
        </Text>
        <Text size="sm" c="var(--color-text-secondary)" style={{ lineHeight: 1.6 }}>
          주문 마감 후 경매 매입·배송 준비가 시작되었거나 생화의 상품 가치가 현저히 감소한 경우
          청약철회가 제한될 수 있습니다. 표시·광고 또는 계약 내용과 다르게 이행된 경우는 제외됩니다.
        </Text>
      </Box>
    </Box>
  );
}
