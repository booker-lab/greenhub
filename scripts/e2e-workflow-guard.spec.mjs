/**
 * 일반 E2E workflow(.github/workflows/e2e.yml) 실행 ref·실행자 사전 검증 계약 spec.
 *
 * Deterministic only: workflow 파일을 텍스트로 읽는다. 네트워크·secret·외부 변경 없음.
 *   node --test scripts/e2e-workflow-guard.spec.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'e2e.yml');

function readWorkflow() {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

function jobSlice(source, startMarker, endMarkers) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `workflow must contain ${startMarker}`);
  let end = source.length;
  for (const marker of endMarkers) {
    const idx = source.indexOf(marker, start + startMarker.length);
    if (idx >= 0 && idx < end) end = idx;
  }
  return source.slice(start, end);
}

describe('e2e.yml 실행 ref·실행자 사전 검증', () => {
  it('사전 검증 job은 권한·secret 없이 ref와 실행자를 fail-closed로 확인한다', () => {
    const gate = jobSlice(readWorkflow(), '  dispatch_gate:\n', ['\n  e2e:\n']);
    assert.match(gate, /permissions: \{\}/, 'dispatch_gate must run with no token permissions');
    assert.ok(!gate.includes('secrets.'), 'dispatch_gate must not read any secret');
    for (const [name, context] of [
      ['REF', 'github.ref'],
      ['ACTOR', 'github.actor'],
      ['TRIGGERING_ACTOR', 'github.triggering_actor'],
      ['REPOSITORY_OWNER', 'github.repository_owner'],
    ]) {
      assert.ok(
        gate.includes(`${name}: $\{{ ${context} }}`),
        `dispatch_gate must read ${context} into ${name}`,
      );
    }
    for (const fragment of [
      `"$REF" != 'refs/heads/preview' && "$REF" != 'refs/heads/main'`,
      '"$ACTOR" != "$REPOSITORY_OWNER"',
      '"$TRIGGERING_ACTOR" != "$REPOSITORY_OWNER"',
    ]) {
      assert.ok(gate.includes(fragment), `dispatch_gate must contain ${fragment}`);
    }
    const exits = gate.match(/exit 1/g) ?? [];
    assert.ok(exits.length >= 4, 'each dispatch_gate check must fail closed');
  });

  it('secret을 읽는 e2e job은 사전 검증 뒤, 같은 조건에서만 시작한다', () => {
    const source = readWorkflow();
    const e2e = jobSlice(source, '\n  e2e:\n', []);
    assert.ok(e2e.includes('secrets.'), 'e2e job is expected to read secrets');
    assert.match(e2e, /\n {4}needs: dispatch_gate\n/, 'e2e must depend on dispatch_gate');
    const header = e2e.slice(0, e2e.indexOf('\n    steps:'));
    for (const fragment of [
      "github.ref == 'refs/heads/preview' || github.ref == 'refs/heads/main'",
      'github.actor == github.repository_owner',
      'github.triggering_actor == github.repository_owner',
    ]) {
      assert.ok(header.includes(fragment), `e2e job-level if must contain ${fragment}`);
    }
    assert.ok(
      !/\balways\(\)|\bfailure\(\)|\bcancelled\(\)/.test(header),
      'e2e job-level if must keep the implicit success() dependency on dispatch_gate',
    );
  });

  it('secret은 e2e job 밖(workflow 수준·다른 job)에서 읽지 않는다', () => {
    const source = readWorkflow();
    const beforeE2e = source.slice(0, source.indexOf('\n  e2e:\n'));
    assert.ok(!beforeE2e.includes('secrets.'), 'secrets must only appear inside the e2e job');
  });
});
