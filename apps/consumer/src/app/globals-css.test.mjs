import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// UI 교체 P6(ui-stack-migration-plan.md §6 P6): Mantine을 걷어낸 뒤의 CSS 연결 계약(판매자·기사 앱과 같다).
const read = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');
const css = await read('globals.css');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const imports = [...css.matchAll(/^@import\s+"([^"]+)"([^;]*);/gm)].map((m) => ({
  path: m[1],
  rest: m[2].trim(),
}));
const paths = imports.map((i) => i.path);

/** `@layer base {` 블록들의 선택자(@media 안 포함). */
function baseSelectors() {
  const selectors = [];
  let from = 0;
  for (;;) {
    const start = rules.indexOf('@layer base {', from);
    if (start < 0) return selectors;
    const block = rules.slice(start, rules.indexOf('\n}\n', start));
    for (const m of block.matchAll(/^\s+([^{}@\n][^{}]*)\{/gm)) {
      selectors.push(...m[1].split(',').map((s) => s.trim()));
    }
    from = start + block.length;
  }
}

test('layer 순서를 맨 앞에 선언한다(Mantine layer 없음)', () => {
  const first = css.split('\n').find((line) => line.startsWith('@'));
  assert.equal(first, '@layer theme, base, components, utilities;');
});

test('Mantine CSS를 import하지 않는다', () => {
  assert.deepEqual(
    imports.filter((i) => i.path.startsWith('@mantine/')),
    [],
  );
  assert.doesNotMatch(css, /layer\(mantine\)/);
});

test('공용 style.css는 base layer로 넣는다(layer 밖 토큰·body 규칙에 진다)', () => {
  assert.deepEqual(
    imports.find((i) => i.path === '@greenhub/ui/style.css'),
    { path: '@greenhub/ui/style.css', rest: 'layer(base)' },
  );
  assert.deepEqual(
    imports.find((i) => i.path === '@greenhub/ui/styles/tokens.css'),
    { path: '@greenhub/ui/styles/tokens.css', rest: '' },
  );
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

test('Mantine이 깔던 기본 규칙을 base layer에 옮긴다', () => {
  const selectors = baseSelectors();
  for (const s of [':root', '*', 'input', 'button', 'textarea', 'select', 'body']) {
    assert.ok(selectors.includes(s), s);
  }
  const base = css.slice(css.indexOf('@layer base {'));
  assert.match(base, /color-scheme:\s*light;/);
  assert.match(base, /box-sizing:\s*border-box;/);
  assert.match(base, /font:\s*inherit;/);
  assert.match(base, /font-family:\s*var\(--font-family\);/);
  assert.match(base, /font-size:\s*var\(--font-size-md\);/);
  assert.match(base, /line-height:\s*1\.55;/);
  assert.match(base, /color:\s*#000;/);
});

test('preflight 대신 채우는 초기화(테두리·여백·모양)는 새 컴포넌트(data-slot)에만 걸린다', () => {
  const resetBlocks = [...rules.matchAll(/^\s+([^{}@\n][^{}]*)\{([^}]*)\}/gm)].filter((m) =>
    /border:\s*0 solid|padding:\s*0;|appearance:\s*none/.test(m[2]),
  );
  assert.ok(resetBlocks.length > 0);
  for (const m of resetBlocks) {
    for (const s of m[1].split(',').map((x) => x.trim())) assert.match(s, /\[data-slot\]/, s);
  }
});

test('layout·providers는 Mantine을 쓰지 않는다(CSS·ColorSchemeScript·MantineProvider)', async () => {
  for (const name of ['layout.tsx', 'providers.tsx']) {
    const source = await read(name);
    assert.ok(!source.includes('@mantine/'), name);
    assert.ok(!source.includes('MantineProvider'), name);
    assert.ok(!source.includes('ColorSchemeScript'), name);
    assert.ok(!source.includes('mantineHtmlProps'), name);
  }
});
