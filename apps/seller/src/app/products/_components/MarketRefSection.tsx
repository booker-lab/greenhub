'use client';

import { FLOWER_MARKET_GUBN_LABELS, FLOWER_MARKET_GUBNS } from '@greenhub/shared';
import { Autocomplete, Select, Stack, Text, TextInput } from '@mantine/core';
import { useMarketCatalog, useMarketLookup } from '@/hooks/useMarketPrices';
import {
  MARKET_PRICE_SOURCE,
  marketLookupQuery,
  type MarketRefForm,
  marketSummaryLines,
  marketUnitLabel,
} from '@/lib/market-price';
import { FieldCard } from './FormPrimitives';

const HINT_STYLE = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' } as const;

const GUBN_OPTIONS = [
  { value: '', label: '연결 안 함' },
  ...FLOWER_MARKET_GUBNS.map((gubn) => ({ value: String(gubn), label: FLOWER_MARKET_GUBN_LABELS[gubn] })),
];

/**
 * 상품이 따를 경매 시세(aT 화훼공판장 경락가격). 손님에게는 보이지 않는다.
 * 이름은 수집된 목록에서 고르거나, 아직 수집 전이면 경매 이름 그대로 적는다.
 */
export function MarketRefSection({
  storeId,
  token,
  value,
  onChange,
}: {
  storeId: string;
  token: string;
  value: MarketRefForm;
  onChange: (next: MarketRefForm) => void;
}) {
  const catalog = useMarketCatalog(storeId, token, value.flowerGubn);
  const lookup = useMarketLookup(storeId, token, marketLookupQuery(value));
  const set = (patch: Partial<MarketRefForm>) => onChange({ ...value, ...patch });

  const pumNames = catalog?.items.map((item) => item.pumName) ?? [];
  const goodNames = catalog?.items.find((item) => item.pumName === value.pumName.trim())?.goodNames ?? [];
  const unit = marketUnitLabel(value.flowerGubn);

  return (
    <FieldCard label="경매 시세 연결 (판매자만 보여요)">
      <Stack gap="xs">
        <Text style={HINT_STYLE}>
          연결하면 회차 가격을 정할 때와 구매 목록에서 최근 경락가로 예상 매입가를 보여 줘요.
        </Text>
        <Select
          aria-label="경매 부류"
          data={GUBN_OPTIONS}
          value={value.flowerGubn}
          onChange={(next) =>
            set({ flowerGubn: (next ?? '') as MarketRefForm['flowerGubn'], pumName: '', goodName: '', grade: '' })
          }
          allowDeselect={false}
          size="md"
          radius="xl"
        />
        {value.flowerGubn !== '' && (
          <>
            <Autocomplete
              aria-label="경매 품목"
              placeholder="품목 (예: 호접란)"
              data={pumNames}
              value={value.pumName}
              onChange={(pumName) => set({ pumName, goodName: '', grade: '' })}
              limit={30}
              size="md"
              radius="xl"
            />
            <Autocomplete
              aria-label="경매 품종"
              placeholder="품종 (비우면 품목 전체)"
              data={goodNames}
              value={value.goodName}
              onChange={(goodName) => set({ goodName, grade: '' })}
              limit={30}
              size="md"
              radius="xl"
            />
            <Autocomplete
              aria-label="경매 등급"
              placeholder="등급 (비우면 전체 등급)"
              data={lookup.summary?.grades ?? []}
              value={value.grade}
              onChange={(grade) => set({ grade })}
              size="md"
              radius="xl"
            />
            <TextInput
              aria-label="상품 1개에 드는 경매 단위 수"
              label={`상품 1개에 드는 경매 단위 수 (1${unit} 기준)`}
              description={unit === '속' ? '예: 꽃다발 하나에 2속이 들면 2' : '예: 화분 하나에 1분이면 1'}
              inputMode="decimal"
              value={value.unitsPerItem}
              onChange={(event) => set({ unitsPerItem: event.currentTarget.value })}
              size="md"
              radius="xl"
            />
            {lookup.summary &&
              marketSummaryLines(lookup.summary).map((line) => (
                <Text key={line} style={{ ...HINT_STYLE, color: 'var(--color-text)' }}>
                  {line}
                </Text>
              ))}
            {lookup.summary && <Text style={HINT_STYLE}>{MARKET_PRICE_SOURCE}</Text>}
            {lookup.error && <Text style={HINT_STYLE}>{lookup.error}</Text>}
            {catalog && catalog.items.length === 0 && (
              <Text style={HINT_STYLE}>아직 수집된 경매 이름이 없어요. 경매 이름을 그대로 적어 두면 수집 뒤에 시세가 보여요.</Text>
            )}
          </>
        )}
      </Stack>
    </FieldCard>
  );
}
