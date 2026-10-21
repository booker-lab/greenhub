import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 오류 화면은 Next가 직접 그리므로 소스에서 계약을 고정한다(소비자 앱 error-boundary.test.mjs와 같은 기준).
const source = (fileName: string) =>
  readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8');

const boundaries = [
  { fileName: 'error.tsx', exportName: 'ErrorPage' },
  { fileName: 'global-error.tsx', exportName: 'GlobalError' },
];

describe.each(boundaries)('$fileName', ({ fileName, exportName }) => {
  const boundarySource = source(fileName);

  it('클라이언트 오류 경계로 한국어 안내와 다시 시도·홈 버튼을 그린다', () => {
    expect(boundarySource).toMatch(/^'use client';/);
    expect(boundarySource).toMatch(new RegExp(`export default function ${exportName}\\(`));
    expect(boundarySource).toContain('잠시 문제가 생겼어요');
    expect(boundarySource).toMatch(/onClick=\{\(\) => retry\(\)\}/);
    expect(boundarySource).toMatch(/>\s*다시 시도\s*</);
    expect(boundarySource).toContain('href="/"');
    expect(boundarySource).toMatch(/>\s*홈으로 가기\s*</);
  });

  it('오류 메시지·스택은 화면에 노출하지 않고 digest만 보여준다', () => {
    expect(boundarySource).not.toMatch(/error\.message/);
    expect(boundarySource).not.toMatch(/error\.stack/);
    expect(boundarySource).not.toMatch(/\{error\}/);
    expect(boundarySource).not.toMatch(/String\(error\)/);
    expect(boundarySource).toContain('{error.digest}');
  });
});

describe('global-error.tsx', () => {
  it('root layout을 대신하므로 html·body를 직접 그리고 Mantine·next/link에 기대지 않는다', () => {
    const globalErrorSource = source('global-error.tsx');
    expect(globalErrorSource).toContain('<html lang="ko">');
    expect(globalErrorSource).toMatch(/<body[\s>]/);
    expect(globalErrorSource).not.toContain('@mantine/core');
    expect(globalErrorSource).not.toContain('next/link');
  });
});

describe('not-found.tsx', () => {
  it('한국어 404 안내와 홈 링크를 그린다', () => {
    const notFoundSource = source('not-found.tsx');
    expect(notFoundSource).toContain('페이지를 찾을 수 없어요');
    expect(notFoundSource).toContain('href="/"');
  });
});
