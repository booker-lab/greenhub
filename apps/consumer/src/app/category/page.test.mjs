import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

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

test('회차 상품 링크는 productId와 roundId를 보존하고 회차 가격을 표시한다', () => {
  assert.match(
    source,
    /products\/\$\{encodeURIComponent\(item\.productId\)\}\?round=\$\{encodeURIComponent\(round\.id\)\}/,
  );
  assert.match(source, /회차 가격/);
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
