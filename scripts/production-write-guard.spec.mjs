import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertProductionWriteAllowed, PRODUCTION_WRITE_FLAG } from './production-write-guard.mjs';

const quiet = { warn: console.warn };

test('운영 프로젝트는 확인 인자가 없으면 거부한다', () => {
  assert.throws(
    () => assertProductionWriteAllowed({ project_id: 'green-e4fe3' }, { script: 's', argv: [] }),
    /운영 Firebase\(green-e4fe3\)/,
  );
  assert.throws(
    () =>
      assertProductionWriteAllowed(
        { project_id: 'green-e4fe3' },
        { script: 's', argv: ['--allow-production'] },
      ),
    /운영 Firebase/,
  );
});

test('운영 프로젝트는 정확한 확인 인자가 있을 때만 허용한다', () => {
  console.warn = () => {};
  try {
    assert.equal(
      assertProductionWriteAllowed(
        { project_id: 'green-e4fe3' },
        { script: 's', argv: [PRODUCTION_WRITE_FLAG] },
      ),
      'green-e4fe3',
    );
  } finally {
    console.warn = quiet.warn;
  }
});

test('비운영 프로젝트는 그대로 허용하고, 프로젝트를 모르면 거부한다', () => {
  assert.equal(
    assertProductionWriteAllowed({ project_id: 'greenhub-staging' }, { script: 's', argv: [] }),
    'greenhub-staging',
  );
  assert.throws(
    () => assertProductionWriteAllowed({}, { script: 's', argv: [] }),
    /확인할 수 없어/,
  );
});

test('테스트·시각 확인용 쓰기 스크립트는 모두 이 가드를 거친다', () => {
  for (const script of [
    'reset-store-data.mjs',
    'seed-orderdate-spread.mjs',
    'seed-prep-today.mjs',
    'seed-settlements-visual.mjs',
    'seed-test-data.mjs',
    'verify-settlement-transition.mjs',
    'migrate-storeId.mjs',
  ]) {
    const source = readFileSync(new URL(`./${script}`, import.meta.url), 'utf8');
    assert.match(source, /assertProductionWriteAllowed\(/, script);
  }
  const apiCopy = readFileSync(new URL('../apps/api/migrate-storeId.mjs', import.meta.url), 'utf8');
  assert.match(apiCopy, /assertProductionWriteAllowed\(/, 'apps/api/migrate-storeId.mjs');
});
