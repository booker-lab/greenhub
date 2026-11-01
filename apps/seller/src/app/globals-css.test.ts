import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// UI 교체 P6(ui-stack-migration-plan.md §6 P6): Mantine을 걷어낸 뒤의 CSS 연결 계약(기사 앱과 같다).
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const css = read('globals.css');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const imports = [...css.matchAll(/^@import\s+"([^"]+)"([^;]*);/gm)].map((m) => ({
  path: m[1],
  rest: m[2].trim(),
}));

/** `@layer base {` 블록들의 선택자(@media 안 포함). */
function baseSelectors() {
  const selectors: string[] = [];
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

describe('globals.css', () => {
  it('layer 순서를 맨 앞에 선언한다(Mantine layer 없음)', () => {
    const first = css.split('\n').find((line) => line.startsWith('@'));
    expect(first).toBe('@layer theme, base, components, utilities;');
  });

  it('Mantine CSS를 import하지 않는다', () => {
    expect(imports.filter((i) => i.path.startsWith('@mantine/'))).toEqual([]);
    expect(css).not.toMatch(/layer\(mantine\)/);
  });

  it('공용 style.css는 base layer로 넣는다(layer 밖 토큰·body 규칙에 진다)', () => {
    expect(imports).toContainEqual({ path: '@greenhub/ui/style.css', rest: 'layer(base)' });
    expect(imports).toContainEqual({ path: '@greenhub/ui/styles/tokens.css', rest: '' });
  });

  it('Tailwind는 preflight 없이 theme·utilities만 각 layer로 연결한다', () => {
    expect(imports.map((i) => i.path)).not.toContain('tailwindcss');
    expect(imports.map((i) => i.path)).not.toContain('tailwindcss/preflight.css');
    expect(imports.map((i) => i.path)).not.toContain('@greenhub/ui/styles/globals.css');
    expect(imports).toContainEqual({ path: 'tailwindcss/theme.css', rest: 'layer(theme)' });
    expect(imports).toContainEqual({ path: 'tailwindcss/utilities.css', rest: 'layer(utilities)' });
    expect(css).toContain('@source "../../../../packages/ui/src";');
  });

  it('@import는 다른 규칙보다 앞에 있다(뒤에 오면 무효)', () => {
    const lastImport = css.lastIndexOf('\n@import ');
    const firstRule = css.search(/\n(@layer base|@font-face|:root|body)\b/);
    expect(lastImport).toBeLessThan(firstRule);
  });

  it('Mantine이 깔던 기본 규칙을 base layer에 옮긴다', () => {
    const selectors = baseSelectors();
    for (const s of [':root', '*', 'input', 'button', 'textarea', 'select', 'body']) {
      expect(selectors, s).toContain(s);
    }
    const base = css.slice(css.indexOf('@layer base {'));
    expect(base).toMatch(/color-scheme:\s*light;/);
    expect(base).toMatch(/box-sizing:\s*border-box;/);
    expect(base).toMatch(/font:\s*inherit;/);
    expect(base).toMatch(/font-family:\s*var\(--font-family\);/);
    expect(base).toMatch(/font-size:\s*var\(--font-size-md\);/);
    expect(base).toMatch(/line-height:\s*1\.55;/);
    expect(base).toMatch(/color:\s*#000;/);
  });

  it('preflight 대신 채우는 초기화(테두리·여백·모양)는 새 컴포넌트(data-slot)에만 걸린다', () => {
    const resetBlocks = [...rules.matchAll(/^\s+([^{}@\n][^{}]*)\{([^}]*)\}/gm)].filter((m) =>
      /border:\s*0 solid|padding:\s*0;|appearance:\s*none/.test(m[2]),
    );
    expect(resetBlocks.length).toBeGreaterThan(0);
    for (const m of resetBlocks) {
      for (const s of m[1].split(',').map((x) => x.trim())) expect(s, s).toContain('[data-slot]');
    }
  });
});

describe('layout·providers', () => {
  it('Mantine을 쓰지 않는다(CSS·ColorSchemeScript·MantineProvider)', () => {
    for (const name of ['layout.tsx', 'providers.tsx']) {
      const source = read(name);
      expect(source, name).not.toContain('@mantine/');
      expect(source, name).not.toContain('MantineProvider');
      expect(source, name).not.toContain('ColorSchemeScript');
    }
  });

  it('루트 layout은 요청마다 그린다(Next가 요청 CSP nonce를 자기 스크립트에 붙인다)', () => {
    expect(read('layout.tsx')).toMatch(/await connection\(\);/);
  });
});
