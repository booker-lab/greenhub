import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 글자 굵기는 400·700·800만 쓴다(design-standard.md §3). 2026-11-26 사용자 결정: 소비자(#877)·판매자처럼
// 기사 앱도 공용 부품 기본값은 두고 앱 래퍼(버튼·입력칸 이름표)에서 700을 준다.
const srcDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const colorSchemeSetting = join(
  srcDirectory,
  '../../../packages/ui/src/components/color-scheme-setting.tsx',
);

const MEDIUM_WEIGHT =
  /var\(--fw-medium\)|\bfont-medium\b|\bfont-semibold\b|fontWeight: ?'?[56]00\b|font-weight: ?[56]00\b/g;

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

// 주석 줄은 세지 않는다(설명에 굵기 이름을 적을 수 있다).
const withoutComments = (source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

test('기사 앱 화면에는 굵기 500·600이 없다', () => {
  for (const path of sourceFiles(srcDirectory)) {
    const matches = withoutComments(readFileSync(path, 'utf8')).match(MEDIUM_WEIGHT) ?? [];
    assert.deepEqual(matches, [], relative(srcDirectory, path));
  }
});

test('기사 버튼 래퍼와 입력칸 이름표는 공용 600 대신 700을 쓴다', () => {
  const read = (path) => readFileSync(join(srcDirectory, path), 'utf8');
  assert.match(read('components/app-button.tsx'), /align-middle font-bold no-underline/);
  assert.match(read('components/fields.tsx'), /const labelClass =\s*'[^']*\bfont-bold\b/);
});

test('내 정보의 화면 모드(공용 부품)는 이름·선택 안 된 칸 400, 선택된 칸 700이다', () => {
  const source = withoutComments(readFileSync(colorSchemeSetting, 'utf8'));
  assert.equal(source.match(MEDIUM_WEIGHT), null);
  assert.match(source, /leading-\[1\.55\] font-normal text-\(--color-text\)/);
  assert.match(source, /leading-none font-normal [^"]*data-checked:font-bold/);
});
