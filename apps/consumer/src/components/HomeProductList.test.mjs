import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./HomeProductList.tsx', import.meta.url), 'utf8');
const tileSource = await readFile(new URL('./RoundTile.tsx', import.meta.url), 'utf8');

test('홈 진입의 당근 유입 캡처는 client effect 안에서만 실행한다', () => {
  assert.match(source, /useEffect\(\(\) => \{\s*captureAcquisition\(\);\s*\}, \[\]\);/s);
  assert.doesNotMatch(source, /window\.|sessionStorage/);
});

test('round_direct 홈은 useSaleRounds 정본과 요구된 안내 순서를 사용한다', () => {
  assert.match(source, /useSaleRounds\(/);
  assert.match(source, /currentRound/);
  assert.match(source, /pastRounds/);

  const roundDirectSource = source.slice(
    source.indexOf('function RoundDirectHome'),
    source.indexOf('function LegacyHomeProductList'),
  );
  const labels = [
    '이번 주 판매',
    '주문 마감',
    '경기도 이천시 직접배송',
    '화요일 오전 9시까지 문 앞 배송',
    '지난 회차',
  ];
  const positions = labels.map((label) => roundDirectSource.indexOf(label));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
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
  assert.match(
    source,
    /formatOrderCloseStatus\(\s*currentRound\.schedule\.orderCloseAt,\s*isRoundOrderClosed\(currentRound, Date\.now\(\)\),\s*\)/,
  );
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
