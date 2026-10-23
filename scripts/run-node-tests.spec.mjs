// scripts/run-node-tests.mjs 회귀 검증. 임시 디렉터리만 쓰고 끝나면 지운다.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectTestFiles } from './run-node-tests.mjs';

const runner = join(dirname(fileURLToPath(import.meta.url)), 'run-node-tests.mjs');

function withFixture(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'run-node-tests-'));
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runRunner(root) {
  // 바깥 node --test가 넣는 NODE_TEST_CONTEXT가 남으면 안쪽 run()이 결과를 부모로 직렬화한다.
  const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
  return spawnSync(process.execPath, [runner, 'src'], { cwd: root, env, encoding: 'utf8' });
}

const passing = "import test from 'node:test';\ntest('통과', () => {});\n";

test('대괄호 경로를 포함해 접미사가 맞는 파일만 정렬해 모으고 node_modules는 뺀다', () => {
  withFixture(
    {
      'src/app/products/[id]/page.test.mjs': passing,
      'src/app/board/[orderId]/photo/a.test.mjs': passing,
      'src/lib/b.test.mjs': passing,
      'src/lib/b.mjs': '',
      'src/node_modules/pkg/c.test.mjs': passing,
    },
    (root) => {
      const files = collectTestFiles(join(root, 'src')).map((file) =>
        file.slice(root.length + 1).replaceAll('\\', '/'),
      );
      assert.deepEqual(files, [
        'src/app/board/[orderId]/photo/a.test.mjs',
        'src/app/products/[id]/page.test.mjs',
        'src/lib/b.test.mjs',
      ]);
    },
  );
});

test('대괄호 경로의 테스트까지 실행하고 통과하면 0으로 끝난다', () => {
  withFixture(
    { 'src/app/products/[id]/page.test.mjs': passing, 'src/lib/b.test.mjs': passing },
    (root) => {
      const result = runRunner(root);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /ℹ tests 2\b/);
    },
  );
});

test('실패한 테스트가 있으면 1로 끝난다', () => {
  withFixture(
    {
      'src/a.test.mjs': passing,
      'src/[id]/b.test.mjs':
        "import test from 'node:test';\ntest('실패', () => { throw new Error('x'); });\n",
    },
    (root) => {
      assert.equal(runRunner(root).status, 1);
    },
  );
});

test('테스트 파일이 없으면 0건 실행을 실패로 본다', () => {
  withFixture({ 'src/lib/b.mjs': '' }, (root) => {
    const result = runRunner(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /0건 실행은 실패로 본다/);
  });
});

test('파일은 있어도 테스트를 1건도 실행하지 않으면 실패로 본다', () => {
  withFixture({ 'src/empty.test.mjs': '' }, (root) => {
    const result = runRunner(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /테스트를 1건도 실행하지 못했다/);
  });
});
