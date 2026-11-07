import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const tileSource = await readFile(new URL('../../components/RoundTile.tsx', import.meta.url), 'utf8');

test('공개 상품의 storeId와 공개 스토어 salesMode로 상품 화면을 분기한다', () => {
  assert.match(source, /product\.storeId/);
  assert.match(source, /normalizeSalesMode/);
  assert.match(source, /salesMode === 'round_direct'/);
  assert.match(source, /<LegacyCategory/);
});

test('round_direct 상품 화면은 useSaleRounds의 현재·지난 회차에서 호접란만 고른다', () => {
  assert.match(source, /useSaleRounds\(/);
  assert.match(source, /currentRound/);
  assert.match(source, /pastRounds/);
  assert.match(source, /product\?\.category === 'orchid'/);
  assert.match(source, /item\.status !== 'HIDDEN'/);
});

test('회차 상품은 홈과 같은 도감 타일로 그리고 링크는 productId와 roundId를 보존한다', () => {
  assert.match(source, /<RoundTileGrid/);
  assert.doesNotMatch(source, /function RoundProductCard/);
  assert.match(
    tileSource,
    /products\/\$\{encodeURIComponent\(item\.productId\)\}\?round=\$\{encodeURIComponent\(round\.id\)\}/,
  );
  assert.match(tileSource, /item\.roundPrice/);
  assert.match(source, /이번 주 회차/);
  assert.match(source, /지난 회차/);
});

test('round_direct 분기는 로딩·오류·빈 상태를 명확히 처리한다', () => {
  const roundDirectSource = source.slice(
    source.indexOf('function RoundDirectCategory'),
    source.indexOf('function LegacyCategory'),
  );

  assert.match(roundDirectSource, /판매 회차 불러오는 중/);
  assert.match(roundDirectSource, /role="alert"/);
  assert.match(roundDirectSource, /다시 시도/);
  assert.match(roundDirectSource, /판매 중인 호접란이 없습니다/);
});

test('round_direct 분기에는 공동구매·택배·거점픽업·전체 상품 목록이 없다', () => {
  const roundDirectSource = source.slice(
    source.indexOf('function RoundDirectCategory'),
    source.indexOf('function LegacyCategory'),
  );

  assert.doesNotMatch(roundDirectSource, /공동구매|택배|거점픽업|전체 상품/);
});

test('round_direct 회차 조회 오류·이전 결과 안내는 useSaleRounds의 고객 문구 한 줄로 보인다', () => {
  const roundDirectSource = source.slice(
    source.indexOf('function RoundDirectCategory'),
    source.indexOf('function LegacyCategory'),
  );
  // error는 useSaleRounds가 고객 문구로 바꿔 준다(원문은 그 훅의 테스트가 막는다).
  assert.equal(roundDirectSource.match(/\{error \?\? saleRoundsErrorMessage\(null\)\}/g)?.length, 2);
  assert.match(roundDirectSource, /지금은 이전에 불러온 회차 정보를 보여 드려요\./);
  assert.doesNotMatch(roundDirectSource, /판매 회차를 불러오지 못했습니다|이전 결과를 표시합니다/);
});
