import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// UI 교체 P5 연결(ui-stack-migration-plan.md §6 P5, 판매자 P2a와 같은 방식):
// Mantine과 Tailwind를 같이 쓰는 동안의 CSS 연결 계약.
const read = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');
const css = await read('globals.css');
const imports = [...css.matchAll(/^@import\s+"([^"]+)"([^;]*);/gm)].map((m) => ({
  path: m[1],
  rest: m[2].trim(),
}));
const paths = imports.map((i) => i.path);

test('layer 순서를 맨 앞에 선언한다(Mantine은 base와 components 사이)', () => {
  const first = css.split('\n').find((line) => line.startsWith('@'));
  assert.equal(first, '@layer theme, base, mantine, components, utilities;');
});

test('Mantine CSS는 모두 layer(mantine) 안에 있다', () => {
  const mantine = imports.filter(
    (i) => i.path.startsWith('@mantine/') || i.path === '@greenhub/ui/style.css',
  );
  assert.ok(mantine.length > 30, `Mantine import ${mantine.length}개`);
  for (const i of mantine) assert.equal(i.rest, 'layer(mantine)', i.path);
});

test('Tailwind는 preflight 없이 theme·utilities만 각 layer로 연결한다', () => {
  assert.ok(!paths.includes('tailwindcss'));
  assert.ok(!paths.includes('tailwindcss/preflight.css'));
  assert.ok(!paths.includes('@greenhub/ui/styles/globals.css'));
  assert.deepEqual(
    imports.find((i) => i.path === 'tailwindcss/theme.css'),
    { path: 'tailwindcss/theme.css', rest: 'layer(theme)' },
  );
  assert.deepEqual(
    imports.find((i) => i.path === 'tailwindcss/utilities.css'),
    { path: 'tailwindcss/utilities.css', rest: 'layer(utilities)' },
  );
  assert.ok(css.includes('@source "../../../../packages/ui/src";'));
});

test('@import는 다른 규칙보다 앞에 있다(뒤에 오면 무효)', () => {
  const lastImport = css.lastIndexOf('\n@import ');
  const firstRule = css.search(/\n(@layer base|@font-face|:root|body)\b/);
  assert.ok(firstRule > 0);
  assert.ok(lastImport < firstRule);
});

test('preflight 대신 채우는 초기화는 새 컴포넌트(data-slot)에만 걸린다', () => {
  const base = css.slice(css.indexOf('@layer base {'));
  const block = base.slice(0, base.indexOf('\n}\n'));
  const selectors = [...block.matchAll(/^\s{2}([^{}\n][^{}]*)\{/gm)].flatMap((m) =>
    m[1].split(',').map((s) => s.trim()),
  );
  assert.ok(selectors.length > 0);
  for (const s of selectors) assert.match(s, /\[data-slot\]/, s);
});

test('layout.tsx는 Mantine CSS를 JS로 import하지 않는다(layer 밖으로 빠진다)', async () => {
  assert.doesNotMatch(await read('layout.tsx'), /import\s+'@mantine\/[^']+\.css'/);
});
