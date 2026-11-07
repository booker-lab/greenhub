import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./_back.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: '_back.ts',
}).outputText;
const backModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  () => {
    throw new Error('예상하지 못한 모듈 요청');
  },
  backModule,
  backModule.exports,
);
const { MYPAGE_BACK_FALLBACK_HREF, resolveMyPageBack } = backModule.exports;

const buttonSource = await readFile(new URL('./_back-button.tsx', import.meta.url), 'utf8');
const screens = {
  addresses: await readFile(new URL('./addresses/_client.tsx', import.meta.url), 'utf8'),
  notifications: await readFile(new URL('./notifications/_client.tsx', import.meta.url), 'utf8'),
  wishlist: await readFile(new URL('./wishlist/page.tsx', import.meta.url), 'utf8'),
  'purchase-history': await readFile(
    new URL('./purchase-history/page.tsx', import.meta.url),
    'utf8',
  ),
};

test('이 탭에 이전 기록이 있으면 브라우저 뒤로가기를 쓴다', () => {
  assert.equal(resolveMyPageBack(2), 'back');
  assert.equal(resolveMyPageBack(10), 'back');
});

test('직접 들어와 기록이 없거나 읽을 수 없으면 MY로 보낸다', () => {
  assert.equal(MYPAGE_BACK_FALLBACK_HREF, '/mypage');
  for (const value of [1, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, undefined, null, '3']) {
    assert.equal(resolveMyPageBack(value), 'fallback', String(value));
  }
});

test('뒤로가기 버튼은 기존 MY 하위 화면과 같은 모양·이름을 쓰고 기록이 없으면 MY로 간다', () => {
  assert.match(buttonSource, /aria-label="뒤로 가기"/);
  assert.match(buttonSource, /variant="ghost"/);
  assert.match(buttonSource, /<ChevronLeft size=\{20\} className="size-5" \/>/);
  assert.match(buttonSource, /resolveMyPageBack\(window\.history\.length\) === 'back'/);
  assert.match(buttonSource, /router\.back\(\)/);
  assert.match(buttonSource, /router\.replace\(MYPAGE_BACK_FALLBACK_HREF\)/);
});

test('배송지·알림 내역·찜·구매한 꽃 화면에 화면 안 뒤로가기가 있다', () => {
  for (const [name, screen] of Object.entries(screens)) {
    assert.match(screen, /import \{ MyPageBackButton \} from '\.\.\/_back-button'/, name);
    assert.match(screen, /<MyPageBackButton \/>/, name);
    // 직접 진입 때 갈 곳이 없는 맨 뒤로가기를 따로 두지 않는다.
    assert.doesNotMatch(screen, /router\.back\(\)/, name);
  }
});
