import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  evaluateDeploy,
  evaluatePullRequest,
  FIX_LABEL,
  migrationFootprint,
  parseAddedLines,
  parseState,
  STATE_FILE,
} from './freeze-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = 'a'.repeat(40);

const change = ({ files = [], added = {}, labels = [], rebuilds = [] } = {}) => ({
  changedFiles: files,
  addedLines: new Map(Object.entries(added)),
  labels,
  rebuildsFrontend: rebuilds,
});

describe('parseState', () => {
  it('저장소의 상태 파일을 읽는다', () => {
    const state = parseState(readFileSync(path.join(ROOT, STATE_FILE), 'utf8'));
    assert.ok(['open', 'pre-candidate', 'candidate'].includes(state.stage));
  });

  it('모르는 구간·후보 SHA 없는 candidate·깨진 JSON은 예외다', () => {
    assert.throws(() => parseState('{"stage":"frozen"}'), /stage/);
    assert.throws(() => parseState('{"stage":"candidate","candidateSha":null}'), /candidateSha/);
    assert.throws(() => parseState('{'), /JSON/);
  });
});

describe('parseAddedLines', () => {
  it('파일별로 새로 들어온 줄만 모은다', () => {
    const diff = [
      'diff --git a/apps/seller/x.tsx b/apps/seller/x.tsx',
      '--- a/apps/seller/x.tsx',
      '+++ b/apps/seller/x.tsx',
      '@@ -1,0 +2,2 @@',
      "+import { Button } from '@greenhub/ui/components/button';",
      "-import { Button } from '@mantine/core';",
      '+++ b/deleted-target',
      'diff --git a/gone.txt b/gone.txt',
      '--- a/gone.txt',
      '+++ /dev/null',
      '-bye',
    ].join('\n');
    const added = parseAddedLines(diff);
    assert.deepEqual(added.get('apps/seller/x.tsx'), [
      "import { Button } from '@greenhub/ui/components/button';",
    ]);
    assert.equal(added.has('gone.txt'), false);
  });
});

describe('migrationFootprint', () => {
  it('교체 전용 경로와 프런트 소스의 교체 흔적을 잡는다', () => {
    const found = migrationFootprint(
      change({
        files: ['packages/ui/src/components/button.tsx', 'apps/seller/postcss.config.mjs'],
        added: {
          'apps/seller/src/app/page.tsx': [
            "import { Button } from '@greenhub/ui/components/button';",
          ],
          'packages/ui/package.json': ['    "@base-ui/react": "1.9.0",'],
          'package.json': ['    "tailwindcss": "4.3.3",'],
        },
      }),
    );
    assert.equal(found.length, 5);
  });

  it('프런트 밖(문서·스크립트·E2E)의 언급과 삭제 줄은 흔적이 아니다', () => {
    const found = migrationFootprint(
      change({
        files: ['docs/x.md', 'scripts/release/freeze-guard.mjs', 'apps/e2e/tests/a.spec.ts'],
        added: {
          'docs/x.md': ['tailwindcss를 넣는다'],
          'scripts/release/freeze-guard.mjs': ['/@greenhub\\/ui\\/(components)/'],
          'apps/e2e/tests/a.spec.ts': ["// '@base-ui/react'"],
        },
      }),
    );
    assert.deepEqual(found, []);
  });

  it('기존 packages/ui 파일(theme.ts·style.css) 수정은 교체 전용 경로가 아니다', () => {
    assert.deepEqual(
      migrationFootprint(
        change({ files: ['packages/ui/src/theme.ts', 'packages/ui/src/style.css'] }),
      ),
      [],
    );
  });
});

describe('evaluatePullRequest', () => {
  const footprint = { files: ['packages/ui/src/styles/tokens.css'] };

  it('open 구간은 아무것도 막지 않는다', () => {
    assert.equal(evaluatePullRequest({ stage: 'open' }, change(footprint)).ok, true);
  });

  it('pre-candidate는 교체 흔적만 막고 다른 프런트 수정은 통과시킨다', () => {
    assert.equal(evaluatePullRequest({ stage: 'pre-candidate' }, change(footprint)).ok, false);
    assert.equal(
      evaluatePullRequest(
        { stage: 'pre-candidate' },
        change({ files: ['apps/consumer/src/app/page.tsx'], rebuilds: ['consumer'] }),
      ).ok,
      true,
    );
  });

  it('candidate는 프런트 재빌드 변경에 수정 라벨을 요구하고, 라벨로 교체 흔적을 통과시키지 않는다', () => {
    const state = { stage: 'candidate', candidateSha: SHA };
    const fix = { files: ['apps/consumer/src/app/page.tsx'], rebuilds: ['consumer'] };
    assert.equal(evaluatePullRequest(state, change(fix)).ok, false);
    assert.equal(evaluatePullRequest(state, change({ ...fix, labels: [FIX_LABEL] })).ok, true);
    assert.equal(
      evaluatePullRequest(state, change({ ...footprint, labels: [FIX_LABEL] })).ok,
      false,
    );
    assert.equal(evaluatePullRequest(state, change({ files: ['apps/api/src/x.ts'] })).ok, true);
  });
});

describe('evaluateDeploy', () => {
  const state = { stage: 'candidate', candidateSha: SHA };

  it('candidate가 아니면 막지 않는다', () => {
    assert.equal(
      evaluateDeploy(
        { stage: 'pre-candidate' },
        { sha: 'b'.repeat(40), descendsFromCandidate: false, footprintSinceCandidate: [] },
      ).ok,
      true,
    );
  });

  it('후보 SHA와 그 뒤의 SHA만 배포하고, 그 사이 교체 코드는 막는다', () => {
    assert.equal(
      evaluateDeploy(state, { sha: SHA, descendsFromCandidate: true, footprintSinceCandidate: [] })
        .ok,
      true,
    );
    assert.equal(
      evaluateDeploy(state, {
        sha: 'b'.repeat(40),
        descendsFromCandidate: false,
        footprintSinceCandidate: [],
      }).ok,
      false,
    );
    assert.equal(
      evaluateDeploy(state, {
        sha: 'b'.repeat(40),
        descendsFromCandidate: true,
        footprintSinceCandidate: ['packages/ui/src/styles/tokens.css: 교체 전용 경로'],
      }).ok,
      false,
    );
  });
});

describe('명령', () => {
  const run = (args) => {
    try {
      return {
        code: 0,
        out: execFileSync('node', ['scripts/release/freeze-guard.mjs', ...args], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      };
    } catch (error) {
      return { code: error.status, out: `${error.stdout}${error.stderr}` };
    }
  };

  it('같은 커밋끼리의 PR 검사는 통과한다', () => {
    const r = run(['pr', '--base', 'HEAD', '--head', 'HEAD']);
    assert.equal(r.code, 0, r.out);
  });

  it('잘못된 인자는 실패로 끝난다', () => {
    assert.notEqual(run(['pr']).code, 0);
    assert.notEqual(run(['deploy', '--sha', 'nope']).code, 0);
    assert.notEqual(run(['unknown']).code, 0);
  });
});
