import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// UI 교체 P2a(ui-stack-migration-plan.md §6 P2): Mantine과 Tailwind를 같이 쓰는 동안의 CSS 연결 계약.
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const css = read('globals.css');
const imports = [...css.matchAll(/^@import\s+"([^"]+)"([^;]*);/gm)].map((m) => ({
  path: m[1],
  rest: m[2].trim(),
}));

describe('globals.css', () => {
  it('layer 순서를 맨 앞에 선언한다(Mantine은 base와 components 사이)', () => {
    const first = css.split('\n').find((line) => line.startsWith('@'));
    expect(first).toBe('@layer theme, base, mantine, components, utilities;');
  });

  it('Mantine CSS는 모두 layer(mantine) 안에 있다', () => {
    const mantine = imports.filter(
      (i) => i.path.startsWith('@mantine/') || i.path === '@greenhub/ui/style.css',
    );
    expect(mantine.length).toBeGreaterThan(30);
    for (const i of mantine) expect(i, i.path).toMatchObject({ rest: 'layer(mantine)' });
    // 알림은 AppToaster(Base UI Toast)가 그린다(UI 교체 P4). @mantine/notifications CSS는 넣지 않는다.
    expect(mantine.map((i) => i.path)).not.toContain('@mantine/notifications/styles.css');
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

  it('preflight 대신 채우는 초기화는 새 컴포넌트(data-slot)에만 걸린다', () => {
    const base = css.slice(css.indexOf('@layer base {'));
    const block = base.slice(0, base.indexOf('\n}\n'));
    const selectors = [...block.matchAll(/^\s{2}([^{}\n][^{}]*)\{/gm)].flatMap((m) =>
      m[1].split(',').map((s) => s.trim()),
    );
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s, s).toContain('[data-slot]');
  });
});

describe('layout.tsx', () => {
  it('Mantine CSS를 JS로 import하지 않는다(layer 밖으로 빠진다)', () => {
    expect(read('layout.tsx')).not.toMatch(/import\s+'@mantine\/[^']+\.css'/);
  });
});
