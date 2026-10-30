// packages/ui 토큰 계약 검사 — UI 교체 P1(docs/specs/frontend/ui-stack-migration-plan.md §4·P1).
// Mantine과 같이 쓰는 동안 새 토큰이 지금 화면을 바꾸지 않는지 확인한다.
// - 앱이 import할 tokens.css에 preflight(`@import "tailwindcss"`)와 `--border` 색 정의가 없다.
// - Tailwind로 실제 컴파일했을 때 style.css와 이름이 같은 변수가 다른 값으로 나오지 않는다.
// - 글자 크기·줄 높이·모서리 유틸리티가 지금 화면 값과 같다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UI = path.join(ROOT, 'packages/ui');
const TOKENS = path.join(UI, 'src/styles/tokens.css');
const LEGACY = path.join(UI, 'src/style.css');
const requireFromUi = createRequire(path.join(UI, 'package.json'));

const tokensText = readFileSync(TOKENS, 'utf8');

/** CSS 블록 안의 `--name: value;` 선언을 모은다(주석 제외). */
function declarations(cssText) {
  const out = new Map();
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const legacy = declarations(readFileSync(LEGACY, 'utf8'));
const tokenRoot = declarations(tokensText.slice(0, tokensText.indexOf('@theme')));

function resolve(value, seen = new Set()) {
  const m = /^var\((--[A-Za-z0-9-]+)\)$/.exec(value);
  if (!m || seen.has(m[1])) return value.toLowerCase();
  seen.add(m[1]);
  const next = tokenRoot.get(m[1]);
  return next === undefined ? value.toLowerCase() : resolve(next, seen);
}

async function compile(utilities) {
  const postcss = requireFromUi('postcss');
  const tailwind = requireFromUi('@tailwindcss/postcss');
  const input = [
    '@layer theme, base, mantine, components, utilities;',
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    `@import "${TOKENS.replaceAll('\\', '/')}";`,
    `@source inline("${utilities.join(' ')}");`,
  ].join('\n');
  const result = await postcss([tailwind({ base: UI, optimize: false })]).process(input, {
    from: path.join(UI, 'src/styles/__tokens-spec__.css'),
  });
  return result.css;
}

describe('tokens.css 원문', () => {
  it('preflight를 끌고 오는 @import "tailwindcss"가 없다', () => {
    const withoutComments = tokensText.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(withoutComments, /@import\s+["']tailwindcss["']/);
  });

  it('--border(현행 묶음 값과 같은 이름)를 정의하지 않는다', () => {
    const withoutComments = tokensText.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(withoutComments, /(^|[\s;{])--border\s*:/);
  });
});

describe('Tailwind 컴파일 결과', () => {
  const utilities = [
    'bg-primary',
    'text-foreground',
    'border-border',
    'border-input',
    'text-xs',
    'text-sm',
    'text-base',
    'rounded-sm',
    'rounded-lg',
    'rounded-full',
  ];

  it('style.css와 이름이 같은 변수는 같은 값만 낸다', async () => {
    const css = await compile(utilities);
    const emitted = declarations(css);
    const clashes = [];
    for (const [name, legacyValue] of legacy) {
      if (!emitted.has(name)) continue;
      const value = resolve(emitted.get(name));
      if (value !== resolve(legacyValue)) clashes.push(`${name}: ${value} (현행 ${legacyValue})`);
    }
    assert.deepEqual(clashes, []);
  });

  it('글자 크기·줄 높이·모서리가 지금 화면 값과 같다', async () => {
    const css = await compile(utilities);
    const emitted = declarations(css);
    const expected = {
      '--text-xs': '13px',
      '--text-xs--line-height': '1.4',
      '--text-sm': '15px',
      '--text-sm--line-height': '1.45',
      '--text-base': '16px',
      '--text-base--line-height': '1.55',
      '--radius-sm': '8px',
      '--radius-lg': '16px',
    };
    for (const [name, value] of Object.entries(expected)) {
      // @theme inline은 값을 유틸리티에 바로 넣으므로 변수 선언이 없을 수도 있다. 있으면 같아야 한다.
      if (emitted.has(name)) assert.equal(emitted.get(name), value, name);
    }
    assert.match(css, /\.text-sm\s*\{[^}]*font-size:\s*15px/);
    assert.match(css, /\.text-sm\s*\{[^}]*line-height:\s*(var\(--tw-leading,\s*)?1\.45/);
    assert.match(css, /\.rounded-sm\s*\{[^}]*border-radius:\s*8px/);
    assert.match(css, /\.rounded-lg\s*\{[^}]*border-radius:\s*16px/);
  });

  it('의미 색 유틸리티는 토큰 변수를 쓰고, 테두리 색은 현행 값이다', async () => {
    const css = await compile(utilities);
    assert.match(css, /\.bg-primary\s*\{[^}]*background-color:\s*var\(--primary\)/);
    assert.match(css, /\.border-border\s*\{[^}]*border-color:\s*#ecefed/i);
    assert.equal(resolve('var(--primary)'), legacy.get('--color-primary').toLowerCase());
  });
});
