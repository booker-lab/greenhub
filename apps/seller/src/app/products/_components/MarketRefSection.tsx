'use client';

import { FLOWER_MARKET_GUBN_LABELS, FLOWER_MARKET_GUBNS } from '@greenhub/shared';
import { Autocomplete } from '@greenhub/ui/components/autocomplete';
import { Field, FieldDescription, FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { NativeSelect } from '@greenhub/ui/components/native-select';
import { useId } from 'react';
import { useMarketCatalog, useMarketLookup } from '@/hooks/useMarketPrices';
import {
  MARKET_PRICE_SOURCE,
  marketLookupQuery,
  type MarketRefForm,
  marketSummaryLines,
  marketUnitLabel,
} from '@/lib/market-price';
import { FieldCard } from './FormPrimitives';

// 다른 상품 편집 칸과 같은 글자(Text p, 여백 0)와 입력칸 모양(md, rounded-xl)을 쓴다.
const TEXT = 'm-0 p-0 text-base font-normal';
const HINT_STYLE = { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' } as const;
const INPUT_CLASS = 'rounded-xl';

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
  const unitsId = useId();
  const catalog = useMarketCatalog(storeId, token, value.flowerGubn);
  const lookup = useMarketLookup(storeId, token, marketLookupQuery(value));
  const set = (patch: Partial<MarketRefForm>) => onChange({ ...value, ...patch });

  const pumNames = catalog?.items.map((item) => item.pumName) ?? [];
  const goodNames = catalog?.items.find((item) => item.pumName === value.pumName.trim())?.goodNames ?? [];
  const unit = marketUnitLabel(value.flowerGubn);

  return (
    <FieldCard label="경매 시세 연결 (판매자만 보여요)">
      <div className="flex flex-col gap-2.5">
        <p className={TEXT} style={HINT_STYLE}>
          연결하면 회차 가격을 정할 때와 구매 목록에서 최근 경락가로 예상 매입가를 보여 줘요.
        </p>
        <NativeSelect
          aria-label="경매 부류"
          data={GUBN_OPTIONS}
          value={value.flowerGubn}
          onChange={(event) =>
            set({
              flowerGubn: event.currentTarget.value as MarketRefForm['flowerGubn'],
              pumName: '',
              goodName: '',
              grade: '',
            })
          }
          size="md"
          className={INPUT_CLASS}
        />
        {value.flowerGubn !== '' && (
          <>
            <Autocomplete
              aria-label="경매 품목"
              placeholder="품목 (예: 호접란)"
              items={pumNames}
              value={value.pumName}
              onValueChange={(pumName) => set({ pumName, goodName: '', grade: '' })}
              className={`h-10.5 px-3.5 text-base ${INPUT_CLASS}`}
            />
            <Autocomplete
              aria-label="경매 품종"
              placeholder="품종 (비우면 품목 전체)"
              items={goodNames}
              value={value.goodName}
              onValueChange={(goodName) => set({ goodName, grade: '' })}
              className={`h-10.5 px-3.5 text-base ${INPUT_CLASS}`}
            />
            <Autocomplete
              aria-label="경매 등급"
              placeholder="등급 (비우면 전체 등급)"
              items={lookup.summary?.grades ?? []}
              value={value.grade}
              onValueChange={(grade) => set({ grade })}
              className={`h-10.5 px-3.5 text-base ${INPUT_CLASS}`}
            />
            <Field>
              <FieldLabel htmlFor={unitsId}>{`상품 1개에 드는 경매 단위 수 (1${unit} 기준)`}</FieldLabel>
              <FieldDescription>
                {unit === '속' ? '예: 꽃다발 하나에 2속이 들면 2' : '예: 화분 하나에 1분이면 1'}
              </FieldDescription>
              <Input
                id={unitsId}
                inputMode="decimal"
                value={value.unitsPerItem}
                onChange={(event) => set({ unitsPerItem: event.currentTarget.value })}
                size="md"
                className={INPUT_CLASS}
              />
            </Field>
            {lookup.summary &&
              marketSummaryLines(lookup.summary).map((line) => (
                <p key={line} className={TEXT} style={{ ...HINT_STYLE, color: 'var(--color-text)' }}>
                  {line}
                </p>
              ))}
            {lookup.summary && (
              <p className={TEXT} style={HINT_STYLE}>
                {MARKET_PRICE_SOURCE}
              </p>
            )}
            {lookup.error && (
              <p className={TEXT} style={HINT_STYLE}>
                {lookup.error}
              </p>
            )}
            {catalog && catalog.items.length === 0 && (
              <p className={TEXT} style={HINT_STYLE}>
                아직 수집된 경매 이름이 없어요. 경매 이름을 그대로 적어 두면 수집 뒤에 시세가 보여요.
              </p>
            )}
          </>
        )}
      </div>
    </FieldCard>
  );
}
