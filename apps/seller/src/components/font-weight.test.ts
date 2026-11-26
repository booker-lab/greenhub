import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 글자 굵기는 400·700·800만 쓴다(design-standard.md §3, 2026-11-26 결정: 판매자 화면, 소비자와 같은 역할별 기준).
// 공용 버튼·입력칸 이름표(600)는 판매자 래퍼(components/Button.tsx·Field.tsx)로만 쓴다.
// 어드민(app/admin)·개발용 화면(app/dev)과 어드민 화면만 쓰는 정지 사유 칸(SuspendReasonMessage)은 이 기준의 대상이 아니다.
const SRC = fileURLToPath(new URL('..', import.meta.url));
const EXCLUDED = /^(app\/(admin|dev)\/|components\/SuspendReasonMessage\.tsx$)/;
const MEDIUM_WEIGHT =
  /var\(--fw-medium\)|\bfont-medium\b|\bfont-semibold\b|fontWeight: ?'?[56]00\b/g;
const SHARED_IMPORT = /from '@greenhub\/ui\/components\/(button|loading-button|field)'/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC)
  .map((path) => ({ path: relative(SRC, path).split('\\').join('/'), path_: path }))
  .filter(({ path }) => !EXCLUDED.test(path))
  .map(({ path, path_ }) => ({
    path,
    // 주석 줄은 세지 않는다(설명에 굵기 이름을 적을 수 있다).
    source: readFileSync(path_, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n'),
  }));

describe('판매자 화면 글자 굵기', () => {
  it('굵기 500·600을 쓰지 않는다', () => {
    const found = files.flatMap(({ path, source }) =>
      (source.match(MEDIUM_WEIGHT) ?? []).map((match) => `${path}: ${match}`),
    );
    expect(found).toEqual([]);
  });

  it('공용 버튼·입력칸 이름표는 700으로 덮는 판매자 래퍼로만 쓴다', () => {
    const direct = files
      .filter(({ path }) => path !== 'components/Button.tsx' && path !== 'components/Field.tsx')
      .filter(({ source }) => SHARED_IMPORT.test(source))
      .map(({ path }) => path);
    expect(direct).toEqual([]);
    const read = (path: string) => files.find((file) => file.path === path)?.source ?? '';
    expect(read('components/Button.tsx').match(/'font-bold'/g)).toHaveLength(3);
    expect(read('components/Field.tsx')).toMatch(/'font-bold'/);
  });
});
