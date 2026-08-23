import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

test('공개 상품의 storeId와 공개 스토어 salesMode로 공동구매 진입을 분기한다', () => {
  assert.match(source, /useProducts\(\)/);
  assert.match(source, /product\.storeId/);
  assert.match(source, /getDoc\(doc\(db, 'stores', storeId\)\)/);
  assert.match(source, /normalizeSalesMode/);
});

test('round_direct 공동구매 직접 진입은 내부 홈 경로로 대체 이동한다', () => {
  assert.match(source, /useRouter\(\)/);
  assert.match(source, /router\.replace\('\/'\)/);
  assert.match(source, /salesMode === 'round_direct'/);
  assert.doesNotMatch(source, /router\.(?:push|replace)\(['"`]https?:\/\//);
});

test('판매 모드 확인 전과 round_direct 이동 중에는 legacy 공동구매 화면을 노출하지 않는다', () => {
  const guardPosition = source.indexOf("storeMode.status !== 'ready'");
  const redirectGuardPosition = source.indexOf("storeMode.salesMode === 'round_direct'");
  const legacyContentPosition = source.indexOf('⚡ 공동구매');

  assert.ok(guardPosition >= 0);
  assert.ok(redirectGuardPosition >= 0);
  assert.ok(legacyContentPosition >= 0);
  assert.ok(guardPosition < legacyContentPosition);
  assert.ok(redirectGuardPosition < legacyContentPosition);
});

test('legacy 공동구매 화면의 기존 상품 상태와 안내를 보존한다', () => {
  assert.match(source, /useProducts\(undefined, undefined, 'group'\)/);
  assert.match(source, /getGroupBuyStatus\(product\.groupSummary, now\) === 'open'/);
  assert.match(source, /else closed\.push\(product\)/);
  assert.match(source, /모집 중/);
  assert.match(source, /모집 종료/);
  assert.match(source, /진행 중인 공동구매가 없습니다/);
});
