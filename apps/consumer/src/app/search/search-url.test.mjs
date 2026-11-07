import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('./page.tsx', import.meta.url), 'utf8');

test('검색 화면은 첫 렌더에 주소의 ?q=를 읽고, useSearchParams를 Suspense 경계 안에서 쓴다', () => {
  assert.match(page, /<Suspense fallback=\{<SearchView urlQuery="" \/>\}>\s*<SearchFromUrl \/>/);
  assert.match(page, /readSearchQuery\(searchParams\)/);
  assert.match(page, /useState\(urlQuery\)/);
});

test('검색어는 기록을 쌓지 않고 입력이 멈추면 주소에 맞춘다', () => {
  assert.match(page, /window\.history\.replaceState\(null, '', buildSearchHref\(/);
  assert.doesNotMatch(page, /pushState|router\.push/);
  assert.match(page, /setTimeout\(syncUrl, SEARCH_URL_SYNC_DELAY_MS\)/);
  // 입력 직후 결과를 눌러도 상세로 가기 전에 주소부터 맞춘다.
  assert.match(page, /onClickCapture=\{syncUrl\}/);
});
