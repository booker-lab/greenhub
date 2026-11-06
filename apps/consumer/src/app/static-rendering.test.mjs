import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('루트 layout은 요청 헤더를 읽지 않아 공개 화면을 정적으로 만들 수 있다', async () => {
  const layout = await read('./layout.tsx');
  assert.doesNotMatch(layout, /next\/headers/);
  assert.doesNotMatch(layout, /headers\(\)|cookies\(\)/);
  // 밝은 모드 하나뿐이라 인라인 색상 모드 스크립트(nonce 필요)를 두지 않는다.
  assert.doesNotMatch(layout, /ColorSchemeScript/);
  assert.match(layout, /<html lang="ko">/);
});

test('로그인이 필요한 화면은 nonce CSP를 쓰도록 동적 렌더링을 유지한다', async () => {
  for (const path of [
    './mypage/layout.tsx',
    './checkout/layout.tsx',
    './order/layout.tsx',
    './cart/layout.tsx',
  ]) {
    assert.match(await read(path), /export const dynamic = 'force-dynamic';/, path);
  }
  assert.match(await read('./login/page.tsx'), /export const dynamic = 'force-dynamic';/);
});

test('가게 화면은 처음 열릴 때 만들어 CDN에 둔다', async () => {
  assert.match(
    await read('./store/[storeId]/layout.tsx'),
    /export async function generateStaticParams\(\)[\s\S]*?\{\s*return \[\];\s*\}/,
  );
});
