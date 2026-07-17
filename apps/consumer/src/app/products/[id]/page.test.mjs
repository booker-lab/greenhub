import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

test('round 쿼리는 단일 문자열만 허용하고 임의 기본 회차를 만들지 않는다', () => {
  assert.match(source, /searchParams: Promise<\{[^}]*round\?: string \| string\[\]/s);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /value\.trim\(\)/);
  assert.match(source, /value\.length/);
  assert.doesNotMatch(source, /round-(?:open|current|default)/);
});

test('공개 상품 storeId와 공개 스토어 salesMode로 상세 경로를 분기한다', () => {
  assert.match(source, /fetch\(`\$\{API_URL\}\/products\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(source, /product\.storeId/);
  assert.match(source, /getDoc\(doc\(db, 'stores', storeId\)\)/);
  assert.match(source, /normalizeSalesMode/);
  assert.match(source, /salesMode !== 'round_direct'/);
});

test('공개 회차 정본으로 상품과 스토어 관계를 모두 검증한다', () => {
  assert.match(source, /useSaleRounds\(/);
  assert.match(source, /currentRound/);
  assert.match(source, /pastRounds/);
  assert.match(source, /round\.storeId !== product\.storeId/);
  assert.match(source, /item\.roundId === round\.id/);
  assert.match(source, /item\.storeId === product\.storeId/);
  assert.match(source, /item\.productId === product\.id/);
  assert.match(source, /item\.status !== 'HIDDEN'/);
});

test('유효한 회차 상품을 현재와 마감 상태로 구분해 상세 경계에 전달한다', () => {
  assert.match(source, /state: 'current' \| 'closed'/);
  assert.match(source, /round\.status === 'OPEN' \|\| round\.status === 'SCHEDULED'/);
  assert.match(source, /roundProduct=\{roundProduct\}/);
  assert.match(source, /data-round-state=\{roundProduct\?\.state\}/);
});

test('판매 모드와 회차 확인 전에는 상세 본문을 노출하지 않고 legacy 구성을 보존한다', () => {
  const loadingGuardPosition = source.indexOf("detail.status !== 'ready'");
  const storeGuardPosition = source.indexOf("storeMode.status !== 'ready'");
  const roundGuardPosition = source.indexOf("saleRounds.status === 'loading'");
  const legacyContentPosition = source.indexOf('roundProduct={null}');
  const roundDetailContentPosition = source.indexOf('roundProduct={roundProduct}');

  assert.ok(loadingGuardPosition >= 0);
  assert.ok(storeGuardPosition >= 0);
  assert.ok(roundGuardPosition >= 0);
  assert.ok(legacyContentPosition >= 0);
  assert.ok(roundDetailContentPosition >= 0);
  assert.ok(loadingGuardPosition < legacyContentPosition);
  assert.ok(storeGuardPosition < legacyContentPosition);
  assert.ok(roundGuardPosition < roundDetailContentPosition);

  assert.match(
    source,
    /<ProductImages images=\{product\.images \?\? \[\]\} name=\{product\.name\} \/>/,
  );
  assert.match(source, /<ProductInfo product=\{product\} variety=\{variety\} \/>/);
  assert.match(source, /<ProductActions product=\{product\} \/>/);
  assert.doesNotMatch(source, /router\.(?:push|replace)/);
});
