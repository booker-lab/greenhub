'use client';

import { Button } from '@greenhub/ui/components/button';
import { InputSection, inputClassName } from '@greenhub/ui/components/input';
import { cn } from '@greenhub/ui/lib/utils';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import ProductRequestBox from '@/components/benchmark/ProductRequestBox';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import { matchesPlantQuery } from '@/lib/benchmark-format';
import { isFeatureOn } from '@/lib/features';

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px·좌우 md 16·아래 96)·Box(좌우 md 16, 위 lg 20·md 16,
// 아래 sm 12)·Stack(gap md 16·sm 12)·SimpleGrid cols 2(gap sm 12)·Text(p, 16px·줄 높이 1.55, size xl은 20px·1.65,
// Text span도 Text라 부모 15px가 아니라 16px·줄 높이 1.55)·Button light(sm)와 같은 값.
const TEXT = 'm-0 p-0 text-[16px] leading-[1.55]';
const XL_TEXT = 'm-0 p-0 text-[20px] leading-[1.65]';
const EMPTY_STACK = 'flex flex-col items-center justify-start gap-4 py-16';
const DISABLED_TEXT_STYLE = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-disabled)',
} as const;
const QUERY_STYLE = { fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' } as const;
// Mantine TextInput(radius lg 16 = 기본과 같음) 바깥 상자(줄 높이 1.55)와 입력 상자(relative). 두 칸은 모두 눌린다
// (Mantine은 rightSectionPointerEvents를 주지 않으면 pointer-events를 정하지 않는다).
// 지우기 단추는 Mantine ActionIcon transparent sm(22px, 1px 투명 테두리, radius 16, 16px·줄 높이 1, 누르면 1px 내려감,
// 초점 링 mantine-focus-auto)과 같은 값.
const CLEAR_BUTTON =
  'relative inline-flex size-[22px] min-h-[22px] min-w-[22px] cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[16px] border border-solid border-transparent bg-transparent p-0 text-start text-[16px] leading-none no-underline select-none touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:translate-y-px';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const { products, loading, error, refetch } = useProducts();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // 식물 이름 검색(plant-search): 별칭·학명과 상품 별칭(aliases)까지 본다.
    if (isFeatureOn('plant-search')) {
      return products.filter((p) =>
        matchesPlantQuery(q, [p.name, p.description, p.content?.headline, ...(p.aliases ?? [])]),
      );
    }
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q),
    );
  }, [query, products]);

  const hasQuery = query.trim().length > 0;

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-24">
      {/* 검색창 */}
      <div
        className="px-4 pt-5 pb-3"
        style={{
          position: 'sticky',
          top: 0,
          backgroundColor: 'var(--color-bg)',
          zIndex: 10,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div className="leading-[1.55]">
          <div className="relative">
            <InputSection side="left" className="pointer-events-auto">
              <Search size={16} />
            </InputSection>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isFeatureOn('plant-search') ? '꽃 이름·별칭으로 찾기' : '상품명을 검색하세요'
              }
              // biome-ignore lint/a11y/noAutofocus: 교체 전(Mantine TextInput autoFocus)과 같은 동작이다.
              autoFocus
              data-slot="input"
              className={cn(inputClassName, 'ps-[34px]', query && 'pe-[34px]')}
            />
            {query ? (
              <InputSection side="right" className="pointer-events-auto">
                <button
                  type="button"
                  className={CLEAR_BUTTON}
                  style={{ color: 'var(--color-text-secondary)' }}
                  onClick={() => setQuery('')}
                >
                  <span>✕</span>
                </button>
              </InputSection>
            ) : null}
          </div>
        </div>
      </div>

      {/* 결과 영역 */}
      <div className="px-4 pt-4">
        {loading && (
          <p className={`${TEXT} py-12 text-center`} style={DISABLED_TEXT_STYLE}>
            불러오는 중...
          </p>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-start gap-3 py-12" role="alert">
            <p className={`${TEXT} text-center`} style={DISABLED_TEXT_STYLE}>
              {error}
            </p>
            <Button type="button" variant="light" onClick={refetch} data-testid="products-retry">
              다시 시도
            </Button>
          </div>
        )}

        {!loading && !error && !hasQuery && (
          <div className={EMPTY_STACK}>
            <p className={XL_TEXT}>🔍</p>
            <p className={TEXT} style={DISABLED_TEXT_STYLE}>
              찾고 싶은 상품을 검색해보세요.
            </p>
          </div>
        )}

        {!loading && hasQuery && filtered.length === 0 && (
          <div className={EMPTY_STACK}>
            <p className={XL_TEXT}>😢</p>
            <p className={TEXT} style={DISABLED_TEXT_STYLE}>
              <span className={TEXT} style={QUERY_STYLE}>
                "{query}"
              </span>
              에 대한 검색 결과가 없습니다.
            </p>
            {isFeatureOn('product-request') && (
              <div className="mt-4 w-full">
                <ProductRequestBox
                  key={query}
                  storeId={products[0]?.storeId ?? null}
                  initialText={query.trim()}
                />
              </div>
            )}
          </div>
        )}

        {!loading && hasQuery && filtered.length > 0 && (
          <>
            <p className={`${TEXT} mb-3`} style={DISABLED_TEXT_STYLE}>
              <span className={TEXT} style={QUERY_STYLE}>
                "{query}"
              </span>{' '}
              검색 결과 {filtered.length}개
            </p>
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
