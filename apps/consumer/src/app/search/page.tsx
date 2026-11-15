'use client';

import { InputSection, inputClassName } from '@greenhub/ui/components/input';
import { cn } from '@greenhub/ui/lib/utils';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, SearchX } from 'lucide-react';
import { Button } from '@/components/Button';
import ProductRequestBox from '@/components/benchmark/ProductRequestBox';
import EmptyStateIcon from '@/components/EmptyStateIcon';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import { matchesPlantQuery } from '@/lib/benchmark-format';
import { isFeatureOn } from '@/lib/features';
import {
  buildSearchHref,
  normalizeSearchQuery,
  readSearchQuery,
  SEARCH_URL_SYNC_DELAY_MS,
} from '@/lib/nav-search-query';
import { TOUCH_HEIGHT } from '@/lib/touch-target';

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px·좌우 md 16·아래 96)·Box(좌우 md 16, 위 lg 20·md 16,
// 아래 sm 12)·Stack(gap md 16·sm 12)·SimpleGrid cols 2(gap sm 12)·Text(p, 16px·줄 높이 1.55, size xl은 20px·1.65,
// Text span도 Text라 부모 15px가 아니라 16px·줄 높이 1.55)·Button light(sm)와 같은 값.
const TEXT = 'm-0 p-0 text-[16px] leading-[1.55]';
const EMPTY_STACK = 'flex flex-col items-center justify-start gap-4 py-16';
const DISABLED_TEXT_STYLE = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-secondary)',
} as const;
const QUERY_STYLE = { fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' } as const;
// Mantine TextInput(radius lg 16 = 기본과 같음) 바깥 상자(줄 높이 1.55)와 입력 상자(relative). 두 칸은 모두 눌린다
// (Mantine은 rightSectionPointerEvents를 주지 않으면 pointer-events를 정하지 않는다).
// 지우기 단추는 Mantine ActionIcon transparent sm(22px, 1px 투명 테두리, radius 16, 16px·줄 높이 1, 누르면 1px 내려감,
// 초점 링 mantine-focus-auto)과 같은 값.
// 지우기(✕) 버튼: 눌리는 영역 44×44px(design-standard §4). 입력칸 오른쪽 칸도 같은 폭으로 둔다.
const CLEAR_BUTTON =
  'relative inline-flex size-11 min-h-11 min-w-11 cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[16px] border border-solid border-transparent bg-transparent p-0 text-start text-[16px] leading-none no-underline select-none touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:translate-y-px';

// 검색어는 주소의 ?q=와 맞춘다. 결과에서 상세로 갔다가 뒤로 오거나 /search?q=호접란 링크로 들어와도
// 검색어와 결과가 남는다. useSearchParams는 정적 화면에서 Suspense 경계가 있어야 하므로(Next 16)
// 경계 밖 첫 HTML에는 빈 검색어 화면을 두고, 브라우저에서 주소의 검색어로 그린다.
export default function SearchPage() {
  return (
    <Suspense fallback={<SearchView urlQuery="" />}>
      <SearchFromUrl />
    </Suspense>
  );
}

function SearchFromUrl() {
  const searchParams = useSearchParams();
  return <SearchView urlQuery={readSearchQuery(searchParams)} />;
}

function SearchView({ urlQuery }: { urlQuery: string }) {
  const [query, setQuery] = useState(urlQuery);
  const { products, loading, error, refetch } = useProducts();

  // 마지막으로 주소에 맞춘 검색어. 주소가 밖에서 바뀌면(링크·앞뒤 이동) 입력을 그 값으로 바꾼다.
  const syncedQueryRef = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery === syncedQueryRef.current) return;
    syncedQueryRef.current = urlQuery;
    setQuery(urlQuery);
  }, [urlQuery]);

  // 주소를 지금 검색어로 맞춘다. 기록을 쌓지 않고 서버도 다시 부르지 않도록 History API의
  // replaceState를 쓴다(Next 라우터가 useSearchParams와 맞춰 준다).
  const syncUrl = useCallback(() => {
    const next = normalizeSearchQuery(query);
    if (next === syncedQueryRef.current) return;
    syncedQueryRef.current = next;
    window.history.replaceState(null, '', buildSearchHref(next, window.location.search));
  }, [query]);

  // 입력할 때마다가 아니라 입력이 잠깐 멈추면 맞춘다.
  useEffect(() => {
    const timer = window.setTimeout(syncUrl, SEARCH_URL_SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [syncUrl]);

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
              // 검색어를 들고 들어오면(뒤로 오기·?q= 링크) 자판이 결과를 가리지 않게 자동 초점을 주지 않는다.
              // biome-ignore lint/a11y/noAutofocus: 교체 전(Mantine TextInput autoFocus)과 같은 동작이다.
              autoFocus={!urlQuery}
              data-slot="input"
              className={cn(inputClassName, TOUCH_HEIGHT, 'ps-[34px]', query && 'pe-11')}
            />
            {query ? (
              <InputSection side="right" className="pointer-events-auto w-11">
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

      {/* 결과 영역: 입력 직후 결과를 누르면 상세로 가기 전에 주소부터 맞춘다. */}
      <div className="px-4 pt-4" onClickCapture={syncUrl}>
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
            <EmptyStateIcon icon={Search} />
            <p className={TEXT} style={DISABLED_TEXT_STYLE}>
              찾고 싶은 상품을 검색해보세요.
            </p>
          </div>
        )}

        {!loading && hasQuery && filtered.length === 0 && (
          <div className={EMPTY_STACK}>
            <EmptyStateIcon icon={SearchX} />
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
