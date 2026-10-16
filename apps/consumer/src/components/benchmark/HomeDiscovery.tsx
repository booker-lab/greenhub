'use client';

import {
  type Curation,
  CURATION_LABELS,
  type LightLevel,
  type Placement,
  PLACEMENT_LABELS,
  type Product,
  type ReviewSummary,
  type SaleRoundItem,
} from '@greenhub/shared';
import { useMemo, useState } from 'react';
import { isFeatureOn } from '@/lib/features';

// 홈 위쪽 큐레이션 탭(curation-tabs)과 분류 칩(category-chips).
// 회차 상품은 한 회차 안에서만 거르므로 서버를 다시 부르지 않고 화면에서 거른다.

export type CurationTab = 'all' | 'best' | Curation;

export type ChipKey =
  | `place:${Placement}`
  | `light:${LightLevel}`
  | 'care:easy'
  | 'price:under30k'
  | 'pet:safe';

const CHIPS: Array<{ key: ChipKey; label: string }> = [
  { key: 'place:living', label: PLACEMENT_LABELS.living },
  { key: 'place:office', label: PLACEMENT_LABELS.office },
  { key: 'place:store', label: PLACEMENT_LABELS.store },
  { key: 'light:low', label: '그늘에서도' },
  { key: 'care:easy', label: '키우기 쉬움' },
  { key: 'price:under30k', label: '3만원 이하' },
  { key: 'pet:safe', label: '반려동물 안심' },
];

const TABS: Array<{ key: CurationTab; label: string }> = [
  { key: 'all', label: '이번 회차' },
  { key: 'best', label: '베스트' },
  { key: 'gift', label: CURATION_LABELS.gift },
  { key: 'monthly', label: CURATION_LABELS.monthly },
];

export interface DiscoveryState {
  tab: CurationTab;
  chips: ReadonlySet<ChipKey>;
}

export function matchesChip(chip: ChipKey, product: Product | undefined, item: SaleRoundItem): boolean {
  if (chip === 'price:under30k') return item.roundPrice <= 30000;
  if (!product) return false;
  if (chip === 'care:easy') return product.selection?.careLevel === 'easy';
  if (chip === 'pet:safe') return product.petSafe === true;
  if (chip.startsWith('place:')) return product.placements?.includes(chip.slice(6) as Placement) ?? false;
  if (chip.startsWith('light:')) {
    const wanted = chip.slice(6) as LightLevel;
    // "그늘에서도"는 반그늘·그늘 상품을 함께 보여준다.
    return wanted === 'low' ? product.light === 'low' || product.light === 'medium' : product.light === wanted;
  }
  return true;
}

export function useDiscovery(
  productsById: ReadonlyMap<string, Product>,
  reviewStats: Record<string, ReviewSummary>,
) {
  const [state, setState] = useState<DiscoveryState>({ tab: 'all', chips: new Set() });
  const active = isFeatureOn('curation-tabs') || isFeatureOn('category-chips');

  const apply = useMemo(() => {
    return (items: SaleRoundItem[]): SaleRoundItem[] => {
      if (!active) return items;
      let result = items.filter((item) => {
        const product = productsById.get(item.productId);
        if (state.tab === 'gift' || state.tab === 'monthly') {
          if (!product?.curations?.includes(state.tab)) return false;
        }
        for (const chip of state.chips) {
          if (!matchesChip(chip, product, item)) return false;
        }
        return true;
      });
      if (state.tab === 'best') {
        const score = (item: SaleRoundItem) => {
          const review = reviewStats[item.productId];
          return review ? review.count * 10 + review.average : 0;
        };
        result = [...result].sort((a, b) => score(b) - score(a)).slice(0, 4);
      }
      return result;
    };
  }, [active, productsById, reviewStats, state]);

  return { state, setState, apply, filtering: active && (state.tab !== 'all' || state.chips.size > 0) };
}

const pill = (selected: boolean) =>
  ({
    background: selected ? 'var(--color-primary)' : 'var(--color-surface-muted)',
    border: 0,
    borderRadius: 'var(--radius-full)',
    color: selected ? 'var(--color-bg)' : 'var(--color-text)',
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--fw-bold)',
    minHeight: 36,
    padding: '0 14px',
    whiteSpace: 'nowrap',
  }) as const;

export default function HomeDiscovery({
  state,
  onChange,
}: {
  state: DiscoveryState;
  onChange: (next: DiscoveryState) => void;
}) {
  const showTabs = isFeatureOn('curation-tabs');
  const showChips = isFeatureOn('category-chips');
  if (!showTabs && !showChips) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
      {showTabs && (
        <div
          role="tablist"
          aria-label="상품 모아보기"
          style={{ borderBottom: 'var(--border)', display: 'flex', gap: 4, overflowX: 'auto' }}
        >
          {TABS.map((tab) => {
            const selected = state.tab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onChange({ ...state, tab: tab.key })}
                style={{
                  background: 'transparent',
                  border: 0,
                  borderBottom: `2px solid ${selected ? 'var(--color-text)' : 'transparent'}`,
                  color: selected ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: selected ? 'var(--fw-extrabold)' : 'var(--fw-bold)',
                  minHeight: 'var(--touch-target)',
                  padding: '0 10px',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
      {showChips && (
        <div aria-label="조건으로 거르기" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {CHIPS.map((chip) => {
            const selected = state.chips.has(chip.key);
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  const chips = new Set(state.chips);
                  if (selected) chips.delete(chip.key);
                  else chips.add(chip.key);
                  onChange({ ...state, chips });
                }}
                style={pill(selected)}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
