import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findUndefinedCssVars } from './check-css-vars.mjs';

test('정의되지 않은 변수만 찾고 대체값·Mantine·인라인 정의는 통과시킨다', () => {
  const missing = findUndefinedCssVars([
    { file: 'ui/style.css', text: ':root { --fw-bold: 700; --radius-sm: 8px; }' },
    {
      file: 'a.tsx',
      text: [
        "style={{ fontWeight: 'var(--fw-bold)' }}",
        "style={{ fontWeight: 'var(--fw-semibold)' }}",
        "style={{ color: 'var(--color-error, #e03131)' }}",
        "style={{ gap: 'var(--mantine-spacing-xs)' }}",
        "style={{ '--local-height': '10px', height: 'var(--local-height)' }}",
      ].join('\n'),
    },
  ]);
  assert.deepEqual(missing, [{ name: '--fw-semibold', files: ['a.tsx'] }]);
});
