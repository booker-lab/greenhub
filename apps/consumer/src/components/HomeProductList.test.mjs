import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./HomeProductList.tsx', import.meta.url), 'utf8');
const tileSource = await readFile(new URL('./RoundTile.tsx', import.meta.url), 'utf8');
const heroSource = await readFile(new URL('./HomeRoundHero.tsx', import.meta.url), 'utf8');
const pillSource = await readFile(new URL('./RoundCountdownPill.tsx', import.meta.url), 'utf8');
const bannerSource = await readFile(new URL('./HeroBanner.tsx', import.meta.url), 'utf8');
const sliceRoundDirect = () =>
  source.slice(
    source.indexOf('function RoundDirectHome'),
    source.indexOf('function LegacyHomeProductList'),
  );
const inOrder = (text, labels) => {
  const positions = labels.map((label) => text.indexOf(label));
  assert.ok(
    positions.every((position) => position >= 0),
    `찾지 못한 글자: ${labels.filter((_, index) => positions[index] < 0).join(', ')}`,
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
};

test('홈 진입의 당근 유입 캡처는 client effect 안에서만 실행한다', () => {
  assert.match(source, /useEffect\(\(\) => \{\s*captureAcquisition\(\);\s*\}, \[\]\);/s);
  assert.doesNotMatch(source, /window\.|sessionStorage/);
});

test('round_direct 홈은 useSaleRounds 정본과 요구된 안내 순서를 사용한다', () => {
  assert.match(source, /useSaleRounds\(/);
  assert.match(source, /currentRound/);
  assert.match(source, /pastRounds/);

  // 회차 홈: 배송일 제목 구역 → 이번 주 판매(타일) → 운영 배너 → 지난 회차 (design-standard.md §5).
  const roundDirectSource = sliceRoundDirect();
  inOrder(roundDirectSource.slice(roundDirectSource.indexOf('gap-7')), [
    '<HomeRoundHero round={currentRound} nextRoundNotice={nextRoundNotice} />',
    '이번 주 판매',
    '<RoundItems round={currentRound} onQuickAdd={handleQuickAdd} />',
    '<RoundBannerSlot banner={banner} />',
    '지난 회차',
  ]);
  // 제목 구역: 배송일 제목 → 마감 알약 → 배송 지역 → 주문 마감 → 배송 약속 → 단계 표시.
  inOrder(heroSource, [
    '{hero.deliveryDate}',
    '문 앞 도착 회차',
    '<RoundCountdownPill target={hero.countdown} />',
    '경기도 이천시 직접 배송',
    "'주문 마감 일정 준비 중'",
    // 배송 약속은 회차 도착 시각에서 만든다(문장·대체 문구는 lib/round-schedule-label 테스트가 고정한다).
    'formatRoundDeliveryPromise(round?.schedule.deliveryEndAt)',
    '<details',
  ]);
  // 요일만 적은 고정 문구를 화면에 직접 쓰지 않는다.
  assert.doesNotMatch(roundDirectSource, /화요일/);
  assert.doesNotMatch(heroSource, /화요일/);
});

test('홈 제목 구역은 상태 함수 하나로 줄어들고 52px 제목은 한 번만 쓴다', () => {
  assert.match(heroSource, /const hero = homeRoundHeroState\(round, now\);/);
  // 제목·알약·단계 표시는 제목 상태가 있을 때만, 안내 줄은 항상 둔다.
  assert.equal(heroSource.match(/\{titled && \(/g)?.length, 2);
  assert.match(heroSource, /<h2\s+id=\{TITLE_ID\}/);
  assert.equal(heroSource.match(/fontSize: 52/g)?.length, 1);
  assert.match(heroSource, /fontSize: 22/);
  assert.doesNotMatch(source, /fontSize: 52/);
  // 지금 단계만 초록 글자이고 접근성 트리에도 지금 단계로 남는다.
  assert.match(heroSource, /aria-current=\{step\.current \? 'step' : undefined\}/);
  assert.match(heroSource, /<summary/);
  // E2E가 기다리는 "주문 마감" 글자가 펼친 날짜 목록에서 한 번 더 잡히지 않게 단계 이름만 쓴다.
  assert.doesNotMatch(heroSource.slice(heroSource.indexOf('<details')), /주문 마감/);
});

test('마감 카운트다운은 전체 폭 띠가 아니라 제목 옆 알약이고 색 면은 마감 색 토큰만 쓴다', () => {
  assert.doesNotMatch(source, /RoundCountdownStrip/);
  assert.match(pillSource, /background: 'var\(--color-deadline\)'/);
  assert.match(pillSource, /color: 'var\(--color-deadline-on\)'/);
  assert.match(pillSource, /borderRadius: 'var\(--radius-full\)'/);
  assert.match(pillSource, /fontVariantNumeric: 'tabular-nums'/);
  // 시간은 마운트 뒤에만 센다(서버 렌더와 첫 화면이 어긋나지 않게).
  assert.match(pillSource, /useState<number \| null>\(null\)/);
  assert.match(pillSource, /formatCountdown\(remaining\)/);
  // 제목 구역의 다른 면에는 바탕색을 칠하지 않는다.
  assert.doesNotMatch(heroSource, /background/);
});

test('운영 배너는 회차 홈에서 타일 아래 연회색 면이고, 예전 판매 홈에서는 위쪽 그대로다', () => {
  assert.match(source, /'--home-banner-surface': 'var\(--color-surface-muted\)'/);
  assert.match(
    bannerSource,
    /backgroundColor: 'var\(--home-banner-surface, var\(--color-primary-surface\)\)'/,
  );
  // 배너가 꺼져 있으면(HeroBanner가 null) 빈 자리를 숨긴다.
  assert.match(source, /className="empty:hidden \[&>\*\]:mb-0"/);
  // 판매 방식을 알기 전과 회차 홈에서는 위쪽에 그리지 않는다.
  assert.match(
    source,
    /const bannerOnTop = storeMode\.status !== 'loading' && !isRoundDirect;/,
  );
  assert.match(source, /\{bannerOnTop && banner\}\s*\{content\}/);
});

test('회차 상품 링크는 productId와 roundId를 함께 보존한다', () => {
  assert.match(source, /<RoundTileGrid/);
  assert.match(
    tileSource,
    /products\/\$\{encodeURIComponent\(item\.productId\)\}\?round=\$\{encodeURIComponent\(round\.id\)\}/,
  );
});

test('legacy 스토어는 기존 홈 상품 흐름으로 분기한다', () => {
  assert.match(source, /salesMode === 'round_direct'/);
  assert.match(source, /<LegacyHomeProductList/);
  assert.match(source, /진행 중 공동구매/);
  assert.match(source, /전체 상품/);
});

test('매장을 알게 되는 즉시 판매 방식·회차 조회를 함께 시작하고 화면 판정 순서는 그대로 둔다', () => {
  const prefetchPosition = source.indexOf(
    'useHomeStorePrefetch(homePrefetchStoreId(storeId, requestedStoreId));',
  );
  const storeModePosition = source.indexOf('const storeMode = useStoreMode(storeId, loading || groupLoading);');
  assert.ok(prefetchPosition >= 0);
  assert.ok(storeModePosition > prefetchPosition);
  // 화면에 보일 매장·판매 방식 판정과 회차 조회 대상은 바뀌지 않는다.
  assert.match(source, /resolveHomeStoreId\(\[\.\.\.products, \.\.\.groupProducts\], requestedStoreId\)/);
  assert.match(
    source,
    /useSaleRounds\(\s*storeMode\.salesMode === 'round_direct' \? storeMode\.storeId : null,\s*\)/,
  );
});

test('주문 마감이 지난 회차는 "~까지" 대신 마감됨 문구로 보인다', () => {
  assert.match(heroSource, /const now = Date\.now\(\);/);
  assert.match(
    heroSource,
    /formatOrderCloseStatus\(\s*round\.schedule\.orderCloseAt,\s*isRoundOrderClosed\(round, now\),\s*\)/,
  );
  assert.doesNotMatch(heroSource, /formatOrderCloseLabel\(/);
  assert.doesNotMatch(source, /formatOrderCloseLabel\(/);
});

test('회차 조회 오류·이전 결과 안내는 useSaleRounds의 고객 문구 한 줄로 보이고 같은 뜻을 두 번 쓰지 않는다', () => {
  const roundDirectSource = source.slice(
    source.indexOf('function RoundDirectHome'),
    source.indexOf('function LegacyHomeProductList'),
  );
  // error는 useSaleRounds가 고객 문구로 바꿔 준다(원문은 그 훅의 테스트가 막는다).
  assert.equal(roundDirectSource.match(/\{error \?\? saleRoundsErrorMessage\(null\)\}/g)?.length, 2);
  assert.match(roundDirectSource, /지금은 이전에 불러온 회차 정보를 보여 드려요\./);
  assert.doesNotMatch(roundDirectSource, /판매 회차를 불러오지 못했습니다|이전 결과를 표시합니다/);
});

test('주문이 끝난 회차 아래에 받아 둔 회차 목록의 다음 회차 주문 시작을 한 줄로 안내한다', () => {
  const roundDirectSource = source.slice(
    source.indexOf('function RoundDirectHome'),
    source.indexOf('function LegacyHomeProductList'),
  );
  // 판정은 순수 함수(lib/round-next-notice)가 하고, 홈은 useSaleRounds가 이미 받은 rounds만 넘긴다.
  assert.match(roundDirectSource, /findNextRoundAfterClose\(rounds, currentRound, Date\.now\(\)\)/);
  assert.match(roundDirectSource, /formatNextRoundNotice\(nextRound\)/);
  // 안내는 제목 구역의 주문 마감 줄 바로 다음, 배송 약속 줄보다 앞에 둔다.
  inOrder(heroSource, [
    "'주문 마감 일정 준비 중'",
    '{nextRoundNotice}',
    'formatRoundDeliveryPromise(',
  ]);
  // 카카오 채널 추가는 기존 컴포넌트를 open-alert 토글 아래에서만 다시 쓴다.
  assert.match(
    roundDirectSource,
    /isFeatureOn\('open-alert'\) && \(currentRound\?\.status === 'SCHEDULED' \|\| nextRoundNotice\) && \(\s*<div className="mb-4">\s*<KakaoChannelCta \/>/,
  );
});
