import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./nav-search-query.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { normalizeSearchQuery, readSearchQuery, buildSearchHref, SEARCH_URL_SYNC_DELAY_MS } =
  module.exports;

test('공백뿐인 검색어는 빈 검색어, 그 밖에는 입력 그대로', () => {
  assert.equal(normalizeSearchQuery('호접란'), '호접란');
  assert.equal(normalizeSearchQuery(' 미니 '), ' 미니 ');
  for (const value of ['', '   ', '\t', null, undefined, 1]) {
    assert.equal(normalizeSearchQuery(value), '', JSON.stringify(value));
  }
});

test('주소의 ?q=에서 검색어를 읽는다', () => {
  assert.equal(readSearchQuery(new URLSearchParams('q=%ED%98%B8%EC%A0%91%EB%9E%80')), '호접란');
  assert.equal(readSearchQuery(new URLSearchParams('q=a+b')), 'a b');
  assert.equal(readSearchQuery(new URLSearchParams('')), '');
  assert.equal(readSearchQuery(new URLSearchParams('q=')), '');
  assert.equal(readSearchQuery(new URLSearchParams('q=%20%20')), '');
});

test('검색어를 담은 주소를 만들고 비면 q를 지운다', () => {
  assert.equal(buildSearchHref('호접란'), `/search?q=${encodeURIComponent('호접란')}`);
  assert.equal(buildSearchHref(''), '/search');
  assert.equal(buildSearchHref('   '), '/search');
  assert.equal(buildSearchHref('', '?q=old'), '/search');
  assert.equal(buildSearchHref('new', '?q=old'), '/search?q=new');
});

test('다른 쿼리 값은 남긴다', () => {
  assert.equal(
    buildSearchHref('미니', '?utm_source=share'),
    `/search?utm_source=share&q=${encodeURIComponent('미니')}`,
  );
  assert.equal(buildSearchHref('', '?utm_source=share&q=old'), '/search?utm_source=share');
});

test('만든 주소를 다시 읽으면 같은 검색어가 나온다', () => {
  for (const query of ['호접란', '미니 다육', 'a&b=c', '50%', '#해시', '/slash', ' 앞뒤 공백 ']) {
    const href = buildSearchHref(query);
    assert.ok(href.startsWith('/search'), href);
    const params = new URL(href, 'https://shop.example.test').searchParams;
    assert.equal(readSearchQuery(params), query, query);
  }
});

test('입력 중 주소 갱신은 잠깐 멈춘 뒤에 한다', () => {
  assert.ok(SEARCH_URL_SYNC_DELAY_MS >= 200 && SEARCH_URL_SYNC_DELAY_MS <= 500);
});
