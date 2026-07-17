import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./HomeProductList.tsx', import.meta.url), 'utf8');

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
  assert.match(
    source,
    /products\/\$\{encodeURIComponent\(item\.productId\)\}\?round=\$\{encodeURIComponent\(round\.id\)\}/,
  );
});

test('legacy 스토어는 기존 홈 상품 흐름으로 분기한다', () => {
  assert.match(source, /salesMode === 'round_direct'/);
  assert.match(source, /<LegacyHomeProductList/);
  assert.match(source, /진행 중 공동구매/);
  assert.match(source, /전체 상품/);
});
