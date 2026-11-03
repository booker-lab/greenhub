import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function declarationsOf(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', start);
  return css
    .slice(start + selector.length + 2, end)
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .sort();
}

describe('기사 다크 모드 무채색 블록(D5, §9.2 기사 행)', () => {
  it('dark.css 뒤에 import 순서로 두어 같은 선택자 값을 이긴다', () => {
    expect(css.indexOf('@import "@greenhub/ui/styles/dark.css"')).toBeGreaterThan(
      css.indexOf('@import "@greenhub/ui/styles/base.css"'),
    );
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/,
    );
  });

  it('기기 설정 어둠과 직접 고른 어둠(D5-b)의 값이 같다', () => {
    const system = declarationsOf(':root:not([data-theme="light"])');
    expect(system).toContain('--color-bg: #121212');
    expect(declarationsOf(':root[data-theme="dark"]')).toEqual(system);
  });
});
