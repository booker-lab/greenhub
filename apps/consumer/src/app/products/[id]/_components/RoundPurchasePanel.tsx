import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import { Badge, Box, Divider, Group, Paper, Stack, Text } from '@mantine/core';

const ORDER_CLOSE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

interface RoundPurchasePanelProps {
  round: SaleRound;
  item: SaleRoundItem;
  state: 'current' | 'closed';
  isPurchasable: boolean;
}

function formatOrderCloseAt(value: string) {
  const orderCloseAt = new Date(value);
  if (Number.isNaN(orderCloseAt.getTime())) return '마감 시각 확인 필요';
  return `${ORDER_CLOSE_FORMATTER.format(orderCloseAt)} (한국시간)`;
}

export default function RoundPurchasePanel({
  round,
  item,
  state,
  isPurchasable,
}: RoundPurchasePanelProps) {
  const closed = state === 'closed';
  const statusLabel = isPurchasable ? '구매 가능' : closed ? '판매 마감' : '판매 예정';

  return (
    <Paper
      component="section"
      mx="md"
      mb="lg"
      p="lg"
      radius="lg"
      aria-labelledby="round-purchase-title"
      data-round-state={state}
      data-round-purchasable={isPurchasable}
      style={{
        border: closed ? '1px solid var(--color-border)' : '2px solid var(--color-primary)',
        background: closed ? 'var(--color-surface-muted)' : 'var(--color-primary-surface)',
      }}
    >
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Box>
            <Text
              id="round-purchase-title"
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
                color: closed ? 'var(--color-text-secondary)' : 'var(--color-primary)',
              }}
            >
              {closed ? '마감된 회차' : '이번 주 판매 회차'}
            </Text>
            <Text
              mt={2}
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              {round.name}
            </Text>
          </Box>
          <Badge color={isPurchasable ? 'green' : closed ? 'gray' : 'yellow'} variant="filled">
            {statusLabel}
          </Badge>
        </Group>

        <Box>
          <Text size="sm" c="var(--color-text-secondary)">
            회차 가격
          </Text>
          <Text
            style={{
              fontSize: 28,
              fontWeight: 'var(--fw-bold)',
              color: closed ? 'var(--color-text-secondary)' : 'var(--color-primary)',
            }}
          >
            {item.roundPrice.toLocaleString('ko-KR')}원
          </Text>
          <Text size="xs" c="var(--color-text-secondary)">
            이 회차 주문에 적용되는 결제 기준 가격입니다.
          </Text>
        </Box>

        <Divider />

        <Stack gap="xs">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Text size="sm" fw="var(--fw-bold)">
              주문 마감
            </Text>
            <Text size="sm" ta="right" c="var(--color-text-secondary)">
              {formatOrderCloseAt(round.schedule.orderCloseAt)}
            </Text>
          </Group>
          <Text size="sm" fw="var(--fw-bold)">
            경기 이천 직접배송
          </Text>
          <Text size="sm" c="var(--color-text-secondary)">
            경기도 이천시 직접배송만 제공하며, 화요일 오전 9시까지 문 앞 배송합니다.
          </Text>
        </Stack>

        <Paper
          p="md"
          radius="md"
          style={{
            background: 'var(--color-caution-bg)',
            border: '1px solid var(--color-caution-border)',
          }}
        >
          <Text size="sm" fw="var(--fw-bold)" mb={4}>
            기상 상황에 따른 배송 연기
          </Text>
          <Text size="sm" c="var(--color-text-secondary)" style={{ lineHeight: 1.6 }}>
            안전한 배송이 어려운 기상 상황에는 배송이 연기될 수 있습니다. 판매자 책임으로 재배송비
            없이 새 배송 일정을 안내합니다.
          </Text>
        </Paper>

        <Box>
          <Text size="sm" fw="var(--fw-bold)" mb={4}>
            청약철회 제한 안내
          </Text>
          <Text size="sm" c="var(--color-text-secondary)" style={{ lineHeight: 1.6 }}>
            주문 마감 후 경매 매입·배송 준비가 시작되었거나 생화의 상품 가치가 현저히 감소한 경우
            청약철회가 제한될 수 있습니다. 표시·광고 또는 계약 내용과 다르게 이행된 경우는
            제외됩니다.
          </Text>
        </Box>
      </Stack>
    </Paper>
  );
}
