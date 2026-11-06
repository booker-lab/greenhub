// 다크 모드 직접 전환(D5-b, docs/specs/frontend/design-direction.md §9.3) 선택자 계약.
// 어둠 값은 두 곳에 같은 값으로 적는다: 기기 설정이 어둠이고 '밝게'를 고르지 않았을 때(미디어 쿼리 안
// `:root:not([data-theme="light"])`), '어둡게'를 골랐을 때(`:root[data-theme="dark"]`).
// 공용 dark.css와 기사 globals.css의 기사 전용 무채색 블록 모두 두 블록의 선언이 같아야 한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MEDIA_SELECTOR =
  /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}\s*\}/g;
const ATTRIBUTE_SELECTOR = /(?:^|\n):root\[data-theme="dark"\] \{([^}]*)\}/g;

/** 블록 안 `--name: value;` 선언을 순서대로 모은다(주석 제외). */
function declarations(block) {
  const text = block.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
}

function blocks(file) {
  const css = readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const media = [...css.matchAll(MEDIA_SELECTOR)].map((m) => declarations(m[1]));
  const attribute = [...css.matchAll(ATTRIBUTE_SELECTOR)]
    .map((m) => declarations(m[1]))
    .filter((list) => list.length > 0);
  return { css, media, attribute };
}

describe('다크 모드 직접 전환 선택자', () => {
  for (const file of ['packages/ui/src/styles/dark.css', 'apps/driver/src/app/globals.css']) {
    it(`${file}: 미디어 쿼리 블록과 data-theme="dark" 블록의 선언이 같다`, () => {
      const { css, media, attribute } = blocks(file);
      assert.equal(media.length, 1, '미디어 쿼리 블록은 하나다');
      assert.equal(attribute.length, 1, 'data-theme="dark" 변수 블록은 하나다');
      assert.ok(media[0].length > 20);
      assert.deepEqual(attribute[0], media[0]);
      // 예전 선택자(미디어 쿼리 안 맨 :root)가 남으면 '밝게'를 골라도 어둠 값이 나온다.
      assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\) \{\s*:root \{/);
    });
  }

  it('dark.css는 고른 모드에 color-scheme을 맞춘다', () => {
    const { css } = blocks('packages/ui/src/styles/dark.css');
    assert.match(css, /:root\[data-theme="light"\] \{\s*color-scheme: light;\s*\}/);
    assert.match(css, /:root\[data-theme="dark"\] \{\s*color-scheme: dark;\s*\}/);
  });
});
