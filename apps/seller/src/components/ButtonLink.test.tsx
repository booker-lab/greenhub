import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Button, ButtonLink } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// 링크를 Base UI Button(nativeButton={false})으로 그리면 a 요소에 role="button"이 붙어 보조기술·테스트가
// 링크를 버튼으로 읽는다(2026-10-31 원격 회차 E2E run 41216933503, seller-sale-rounds.spec.ts:139 실패).
// 링크는 ButtonLink로 그린다. 이 테스트는 그 의미(role=link)와 재발 방지(소스 검사)를 지킨다.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SOURCE_DIRS = ['apps/seller/src', 'apps/driver/src', 'apps/consumer/src', 'packages/ui/src'];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
}

/** `<Button`·`<ButtonPrimitive` 여는 태그를 중괄호 깊이를 세며 잘라 낸다(속성 안의 JSX `>`에 끊기지 않게). */
function buttonOpeningTags(source: string): { tag: string; line: number }[] {
  const tags: { tag: string; line: number }[] = [];
  const re = /<(Button|ButtonPrimitive)(?=[\s/>])/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0;
    let end = m.index + m[0].length;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push({
      tag: source.slice(m.index, end + 1),
      line: source.slice(0, m.index).split('\n').length,
    });
  }
  return tags;
}

function findLinkButtons(source: string): { tag: string; line: number }[] {
  return buttonOpeningTags(source).filter(
    ({ tag }) =>
      /\bnativeButton=\{\s*false\s*\}/.test(tag) || /\brender=\{[\s\S]*<(Link|a)[\s/>]/.test(tag),
  );
}

describe('링크는 ButtonLink로 그린다', () => {
  it('ButtonLink는 role 없는 a 요소(링크)로 그리고 Button과 같은 클래스·data-slot을 갖는다', () => {
    const html = renderToStaticMarkup(
      <ButtonLink href="tel:01012345678" variant="light" size="md">
        전화 걸기
      </ButtonLink>,
    );
    expect(html.startsWith('<a ')).toBe(true);
    expect(html).not.toContain('role=');
    expect(html).toContain('href="tel:01012345678"');
    expect(html).toContain('data-slot="button"');
    const buttonHtml = renderToStaticMarkup(
      <Button variant="light" size="md">
        전화 걸기
      </Button>,
    );
    const classOf = (markup: string) => markup.match(/ class="([^"]*)"/)?.[1];
    expect(classOf(html)).toBeTruthy();
    expect(classOf(html)).toBe(classOf(buttonHtml));
    expect(html).toContain('<span data-slot="button-label"');
  });

  it('Next.js Link로 그려도 role 없는 a 요소이고 href·접근 이름이 그대로다', () => {
    const html = renderToStaticMarkup(
      <ButtonLink render={<Link href="/orders?tab=ACTION_REQUIRED" />} size="xs">
        확인 필요 2건
      </ButtonLink>,
    );
    expect(html).toMatch(/^<a [^>]*href="\/orders\?tab=ACTION_REQUIRED"/);
    expect(html).not.toContain('role=');
    expect(html).toContain('확인 필요 2건');
  });

  it('대조: Base UI Button에 a를 그리면 role="button"이 붙는다(이 검사가 막는 회귀)', () => {
    const html = renderToStaticMarkup(
      <Button render={<a href="/login" />} nativeButton={false}>
        로그인 화면으로
      </Button>,
    );
    expect(html).toContain('role="button"');
    expect(
      findLinkButtons('<Button render={<a href="/login" />} nativeButton={false}>'),
    ).toHaveLength(1);
    expect(findLinkButtons('<Button\n  render={<Link href="/" />}\n  size="xs"\n>')).toHaveLength(
      1,
    );
    expect(findLinkButtons('<Button size="xs" onClick={() => go(a > b)}>')).toHaveLength(0);
  });

  it('앱·packages/ui 소스에 링크를 Button(nativeButton={false}·render=<Link|a>)으로 그린 곳이 없다', () => {
    const files: string[] = [];
    for (const dir of SOURCE_DIRS) walk(join(ROOT, dir), files);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((file) =>
      findLinkButtons(readFileSync(file, 'utf8')).map(
        ({ line }) => `${relative(ROOT, file)}:${line}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
