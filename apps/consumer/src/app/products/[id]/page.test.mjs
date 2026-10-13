import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./ProductDetailClient.tsx', import.meta.url), 'utf8');
const serverPageSource = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');
const serverDataSource = await readFile(new URL('./product-server.ts', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('./layout.tsx', import.meta.url), 'utf8');

test('round 쿼리는 단일 문자열만 허용하고 임의 기본 회차를 만들지 않는다', () => {
  assert.match(source, /roundQuery: string \| string\[\] \| undefined;/);
  assert.match(source, /const roundId = readRoundId\(roundQuery\);/);
  assert.match(serverPageSource, /roundQuery=\{query\.round\}/);
  assert.match(source, /typeof value !== 'string'/);
  assert.match(source, /value\.trim\(\)/);
  assert.match(source, /value\.length/);
  assert.doesNotMatch(source, /round-(?:open|current|default)/);
});

test('공개 상품 storeId와 공개 스토어 salesMode로 상세 경로를 분기한다', () => {
  assert.match(source, /fetch\(`\$\{API_URL\}\/products\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(source, /product\.storeId/);
  assert.match(source, /fetchPublicStoreProfile\(storeId\)/);
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
  const roundDetailContentPosition = source.indexOf(
    '<ProductDetailContent product={product} variety={variety} roundProduct={roundProduct} />',
  );

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
  // legacy(roundProduct=null)에서는 상품 정보 요약을 그대로 보인다.
  assert.match(
    source,
    /<ProductInfo product=\{product\} variety=\{variety\} showSummary=\{!roundProduct\} \/>/,
  );
  assert.match(source, /<ProductActions product=\{product\} \/>/);

  // 상세 진입·판매 모드 분기·legacy 본문은 다른 경로로 이동하지 않는다.
  // 유일한 이동은 round_direct 상세가 같은 경로에 연결 회차 쿼리를 남기는 replace다.
  const pageStart = source.indexOf('export default function ProductDetailClient');
  const contentStart = source.indexOf('function ProductDetailContent(');
  const contentEnd = source.indexOf('function RoundDirectProductDetail(', contentStart);
  assert.ok(pageStart >= 0 && contentStart >= 0 && contentEnd > contentStart);
  assert.doesNotMatch(source.slice(pageStart), /router\.(?:push|replace)/);
  assert.doesNotMatch(source.slice(contentStart, contentEnd), /router\.(?:push|replace)/);
  const navigations = source.match(/router\.(?:push|replace)\(/g) ?? [];
  assert.equal(navigations.length, 1);
  assert.match(
    source,
    /router\.replace\(`\$\{pathname\}\?\$\{query\.toString\(\)\}`, \{ scroll: false \}\)/,
  );
});

test('상품 상세 mount는 기존 당근 유입 캡처 함수를 호출한다', () => {
  const start = source.indexOf('export default function ProductDetailClient');
  const pageSource = source.slice(start);

  assert.notEqual(start, -1);
  assert.match(source, /import \{ captureAcquisition \} from '@\/lib\/acquisition'/);
  assert.match(pageSource, /useEffect\(\(\) => \{\s*captureAcquisition\(\);\s*\}, \[\]\);/s);
});

test('round 없이 들어온 상품 주소는 공개 현재 회차에 그 상품이 있을 때만 그 회차로 잇는다', () => {
  assert.match(
    source,
    /function findCurrentRoundIdForProduct\(product: Product, currentRound: PublicSaleRound \| null\)/,
  );
  assert.match(source, /resolveRoundProduct\(product, currentRound\.id, currentRound, \[\]\)/);
  assert.match(source, /!roundId && roundsSettled/);
  assert.match(source, /const effectiveRoundId = roundId \?\? linkedRoundId;/);
  assert.match(source, /query\.set\('round', linkedRoundId\)/);
  assert.match(source, /이번 회차에서 판매하지 않는 상품이에요\./);
  assert.match(source, /이번 주 상품 보기/);
  assert.doesNotMatch(source, /유효한 판매 회차가 지정되지 않았습니다/);
});

test('회차에 없는 상품은 사진·이름·설명을 보이되 원래 가격·구매 버튼 없이 이번 주 상품 안내를 둔다', () => {
  const start = source.indexOf('function RoundUnavailableProductDetail(');
  const end = source.indexOf('function ProductDetailContent(');
  assert.ok(start !== -1 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /<ProductImages /);
  assert.match(block, /\{product\.name\}/);
  assert.match(
    block,
    /<ProductInfo product=\{product\} variety=\{variety\} showSummary=\{false\} \/>/,
  );
  assert.match(block, /href="\/"/);
  assert.doesNotMatch(block, /ProductActions/);
  assert.doesNotMatch(block, /product\.price/);
});

test('서버 단서로 상품·매장·품종 조회를 함께 시작하되, 화면은 최신 상품으로만 그린다', () => {
  // 서버 화면은 메타데이터와 같은 요청 안의 상품 조회를 재사용해 매장·품종 ID만 넘긴다.
  assert.doesNotMatch(serverPageSource, /'use client'/);
  assert.match(serverPageSource, /loadProductHint\(id\)/);
  assert.match(
    serverPageSource,
    /<ProductDetailClient id=\{id\} roundQuery=\{query\.round\} hint=\{hint\} \/>/,
  );
  assert.match(serverDataSource, /export const fetchCachedProduct = cache\(/);
  assert.match(layoutSource, /fetchCachedProduct\(id\)/);
  assert.match(
    serverDataSource,
    /storeId: optionalId\(product\.storeId\), varietyId: optionalId\(product\.varietyId\)/,
  );

  // 다른 상품의 단서는 쓰지 않는다.
  assert.match(source, /const validHint = hint\?\.id === id \? hint : null;/);
  // 매장 판매 방식은 단서로 먼저 읽고, 최신 상품이 오면 그 매장으로 다시 맞춘다.
  assert.match(
    source,
    /useStoreMode\(readyProduct\?\.storeId \?\? validHint\?\.storeId \?\? null\)/,
  );
  assert.match(source, /storeMode\.storeId !== product\.storeId/);
  // 품종도 함께 읽고, 최신 상품의 품종이 다르면 다시 읽는다.
  assert.match(source, /product\.varietyId === hintVarietyId && hintedVariety/);
  assert.match(source, /await fetchVariety\(product\.varietyId, controller\.signal\)/);
  // 상품 본문은 여전히 브라우저가 새로 읽은 상품으로만 그린다.
  assert.match(source, /fetchProduct\(id, controller\.signal\)/);
});
