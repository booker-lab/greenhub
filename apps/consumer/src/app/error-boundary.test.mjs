import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const source = (fileName) => readFileSync(join(testDirectory, fileName), 'utf8');

const boundaries = [
  { fileName: 'error.tsx', exportName: 'ErrorPage' },
  { fileName: 'global-error.tsx', exportName: 'GlobalError' },
];

for (const { fileName, exportName } of boundaries) {
  const boundarySource = source(fileName);

  test(`${fileName}: 클라이언트 오류 경계로 한국어 안내와 다시 시도 버튼을 그린다`, () => {
    assert.match(boundarySource, /^'use client';/);
    assert.match(boundarySource, new RegExp(`export default function ${exportName}\\(`));
    assert.match(boundarySource, /잠시 문제가 생겼어요/);
    assert.match(boundarySource, /onClick=\{\(\) => retry\(\)\}/);
    assert.match(boundarySource, />\s*다시 시도\s*</);
    assert.match(boundarySource, /href="\/"/);
    assert.match(boundarySource, />\s*홈으로 가기\s*</);
  });

  test(`${fileName}: 고객센터 연락처는 공개 사업자 정본을 재사용하고 하드코딩하지 않는다`, () => {
    assert.match(
      boundarySource,
      /import \{ PUBLIC_BUSINESS_INFO \} from '@\/lib\/publicBusinessInfo';/,
    );
    assert.match(boundarySource, /PUBLIC_BUSINESS_INFO\.phoneHref/);
    assert.match(boundarySource, /PUBLIC_BUSINESS_INFO\.phone\}/);
    assert.doesNotMatch(boundarySource, /010-?4452-?2104/);
  });

  test(`${fileName}: 오류 메시지·스택은 화면에 노출하지 않고 digest만 보여준다`, () => {
    assert.doesNotMatch(boundarySource, /error\.message/);
    assert.doesNotMatch(boundarySource, /error\.stack/);
    assert.doesNotMatch(boundarySource, /\{error\}/);
    assert.doesNotMatch(boundarySource, /String\(error\)/);
    assert.doesNotMatch(boundarySource, /JSON\.stringify\(error/);
    assert.match(boundarySource, /\{error\.digest\}/);
  });
}

test('global-error.tsx: root layout을 대신하므로 html과 body를 직접 그린다', () => {
  const globalErrorSource = source('global-error.tsx');
  assert.match(globalErrorSource, /<html lang="ko">/);
  assert.match(globalErrorSource, /<body[\s>]/);
  // root layout·Providers가 없는 상태라 UI 라이브러리·next/link에 기대지 않는다
  assert.doesNotMatch(globalErrorSource, /@mantine\/core/);
  assert.doesNotMatch(globalErrorSource, /next\/link/);
});

test('error.tsx: not-found 화면과 같은 디자인 토큰을 쓴다', () => {
  const errorSource = source('error.tsx');
  for (const token of [
    'var(--color-surface-muted)',
    'var(--color-primary)',
    'var(--touch-target)',
    'var(--font-size-lg)',
  ]) {
    assert.ok(errorSource.includes(token), `${token} 토큰이 없다`);
  }
});
