import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./share-metadata.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { buildProductShareMetadata, DEFAULT_SHARE_IMAGE, SITE_SHARE_DESCRIPTION } = module.exports;

test('상품 이름·설명·첫 사진으로 미리보기를 만든다', () => {
  const metadata = buildProductShareMetadata({
    name: ' 빅립 ',
    description: '분홍색 꽃이\n크게 핍니다.',
    images: ['https://storage.example/bigleap.jpg', 'https://storage.example/2.jpg'],
  });
  assert.equal(metadata.title, '빅립 | 그린러브');
  assert.equal(metadata.description, '분홍색 꽃이 크게 핍니다.');
  assert.deepEqual(metadata.openGraph.images, [{ url: 'https://storage.example/bigleap.jpg' }]);
  assert.equal(metadata.openGraph.locale, 'ko_KR');
});

test('긴 설명은 80자로 줄이고, 설명이 없으면 사이트 문구를 쓴다', () => {
  const long = buildProductShareMetadata({ name: 'v3', description: '가'.repeat(100) });
  assert.equal(long.description, `${'가'.repeat(80)}…`);
  const empty = buildProductShareMetadata({ name: 'v3', description: '  ' });
  assert.equal(empty.description, SITE_SHARE_DESCRIPTION);
});

test('https 사진이 없으면 기본 이미지를 쓴다', () => {
  const metadata = buildProductShareMetadata({ name: '만천홍', images: ['http://insecure/a.jpg', 3] });
  assert.deepEqual(metadata.openGraph.images, [{ url: DEFAULT_SHARE_IMAGE }]);
});

test('이름이 없으면 null을 돌려 사이트 기본값을 쓰게 한다', () => {
  assert.equal(buildProductShareMetadata({}), null);
  assert.equal(buildProductShareMetadata({ name: '  ' }), null);
});
