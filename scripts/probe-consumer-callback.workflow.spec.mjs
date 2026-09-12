/**
 * PILOT-AUTH-CALLBACK dynamic exact-binding workflow contract spec
 * (PILOT-AUTH-CALLBACK-DYNAMIC-EXACT-BINDING-CONTRACT-22).
 *
 * Deterministic only: reads .github/workflows/probe-auth-runtime.yml as text
 * plus the callback runner's invocation-scoped binding contract and the
 * session runner's network allowlist. No network, no secrets, no external
 * mutation. Run:
 *   node --test scripts/probe-consumer-callback.workflow.spec.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as callbackModule from './probe-consumer-callback.mjs';
import {
  APPROVAL_VALUE,
  CREDENTIAL_SOURCE,
  HEADER_NAME,
  assertInvocationBinding,
} from './probe-consumer-callback.mjs';
import { readFileSync as readRunnerSource } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'probe-auth-runtime.yml');
const SESSION_RUNNER_PATH = path.join(REPO_ROOT, 'scripts', 'probe-auth-runtime.mjs');
const CALLBACK_RUNNER_PATH = path.join(REPO_ROOT, 'scripts', 'probe-consumer-callback.mjs');

function readWorkflow() {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

/** Slice of the callback-probe job (last job in the workflow file). */
function callbackSlice(source) {
  const start = source.indexOf('callback-probe:');
  assert.ok(start >= 0, 'workflow must contain the callback-probe job');
  return source.slice(start);
}

function sessionSlice(source) {
  const start = source.indexOf('session-probe:');
  assert.ok(start >= 0, 'workflow must contain the session-probe job');
  const end = source.indexOf('callback-probe:');
  return source.slice(start, end >= 0 ? end : source.length);
}

describe('callback probe workflow isolation contract', () => {
  it('callback runner uses invocation-scoped binding (no static historical lock)', () => {
    assert.equal('LOCKED_DEPLOYMENT_ID' in callbackModule, false);
    assert.equal('LOCKED_SOURCE_SHA' in callbackModule, false);
    assert.equal('LOCKED_BRANCH' in callbackModule, false);
    assert.equal(typeof assertInvocationBinding, 'function');
    // Arbitrary new exact inputs are admissible as invocation bindings.
    assert.deepEqual(
      assertInvocationBinding({
        deploymentId: 'dpl_WorkflowSpecDynamic111111',
        expectedSha: '0123456789abcdef0123456789abcdef01234567',
      }),
      {
        deploymentId: 'dpl_WorkflowSpecDynamic111111',
        expectedSha: '0123456789abcdef0123456789abcdef01234567',
      },
    );
    assert.equal(HEADER_NAME, 'x-e2e-test-token');
    assert.equal(CREDENTIAL_SOURCE, 'E2E_TEST_SECRET');
    assert.equal(APPROVAL_VALUE, 'NON_PRODUCTION_AUTH_PROBE_APPROVED');
  });

  it('callback runner source carries no historical literal target', () => {
    const runner = readRunnerSource(CALLBACK_RUNNER_PATH, 'utf8');
    assert.ok(!runner.includes('dpl_B7TCW4CzUgWZv9JTUffMdpjCY7Qd'), 'historical deployment literal must be gone');
    assert.ok(!runner.includes('67632ede1d7196456bcf1fe5320a7a7e7d509c0c'), 'historical SHA literal must be gone');
    assert.ok(!runner.includes('tmp/pilot-auth-verifier-cookie-04a-publication-01'), 'historical branch literal must be gone');
    assert.ok(!/export const LOCKED_/.test(runner), 'no LOCKED_* export may remain');
    assert.ok(runner.includes('assertInvocationBinding'), 'invocation binding entrypoint must exist');
    assert.ok(runner.includes('evidence.ready !== true'), 'exact READY proof must be required');
  });

  it('callback-probe is an isolated job gated on manual dispatch only', () => {
    const source = readWorkflow();
    const slice = callbackSlice(source);
    assert.ok(
      slice.includes("name: locked Consumer callback input-binding probe"),
      'callback job must carry its isolation name',
    );
    assert.ok(slice.includes('needs: approval_gate'), 'callback job must need only approval_gate');
    assert.ok(!/^(\s*)needs:.*session-probe/m.test(slice), 'callback must not depend on session-probe');
    assert.ok(
      slice.includes("github.event_name == 'workflow_dispatch'"),
      'callback job must gate on workflow_dispatch',
    );
    assert.ok(
      slice.includes('workflow_dispatch 이외의 이벤트에서는 callback probe를 실행할 수 없습니다.'),
      'non-dispatch events must fail closed with an explicit callback message',
    );
    assert.ok(slice.includes('group: auth-callback-probe'), 'callback job must use its own concurrency group');
  });

  it('session-probe job is untouched by the callback integration', () => {
    const source = readWorkflow();
    const slice = sessionSlice(source);
    assert.ok(
      slice.includes('name: pinned Preview session-only auth probe'),
      'session job name must be preserved',
    );
    assert.ok(
      slice.includes('node scripts/probe-auth-runtime.mjs'),
      'session job must still invoke only the session runner',
    );
    assert.ok(
      !slice.includes('probe-consumer-callback.mjs'),
      'session job must never invoke the callback runner',
    );
    assert.ok(
      !slice.includes('auth-callback-probe-'),
      'session job must not reference callback artifact paths',
    );
  });

  it('callback code checkout follows the workflow ref, binding follows the invocation exact SHA', () => {
    const slice = callbackSlice(readWorkflow());
    assert.ok(
      slice.includes('ref: ${{ github.sha }}'),
      'callback job must checkout the workflow ref (probe code only exists post-publication)',
    );
    assert.ok(
      slice.includes('git rev-parse HEAD'),
      'checkout SHA must be compared against the workflow SHA',
    );
    assert.ok(
      slice.includes('checkout SHA가 workflow SHA와 달라 실행을 차단합니다.'),
      'code checkout mismatch must fail closed with an explicit message',
    );
    assert.ok(
      slice.includes('--sha="$AUTH_CALLBACK_EXPECTED_SHA"'),
      'deployment binding must still follow inputs.expected_sha (invocation exact input)',
    );
    assert.ok(
      slice.includes('--expected-sha="$AUTH_CALLBACK_EXPECTED_SHA"'),
      'callback probe binding must follow inputs.expected_sha (invocation exact input)',
    );
  });

  it('callback job binds round-direct-e2e without touching session allowlists', () => {
    const source = readWorkflow();
    const slice = callbackSlice(source);
    assert.ok(slice.includes('name: round-direct-e2e'), 'callback job must bind round-direct-e2e');
    assert.ok(slice.includes('contents: read'), 'callback job must keep contents: read');
    assert.ok(
      !slice.includes('node scripts/probe-auth-runtime.mjs'),
      'callback job must never invoke the session/API runner',
    );
  });

  it('session runner ALLOWED_API_PATHS is not widened for callback purposes', () => {
    const runner = readRunnerSource(SESSION_RUNNER_PATH, 'utf8');
    assert.ok(
      runner.includes("'/auth/login', '/auth/me', '/auth/logout'"),
      'session runner allowlist must stay exactly the three session paths',
    );
    assert.ok(
      !runner.includes('/api/auth/callback'),
      'session runner must not gain a callback path',
    );
    const source = readWorkflow();
    assert.ok(
      !source.includes('/api/auth/callback'),
      'workflow must not hardcode callback URL paths outside the runner',
    );
  });

  it('callback job targets only the Consumer frontend origin', () => {
    const slice = callbackSlice(readWorkflow());
    assert.ok(slice.includes('--consumer-url='), 'callback invocation must pass --consumer-url=');
    assert.ok(slice.includes('--consumer-deployment-id='), 'callback invocation must pass --consumer-deployment-id=');
    assert.ok(slice.includes('--expected-sha='), 'callback invocation must pass --expected-sha=');
    assert.ok(slice.includes('--evidence-json='), 'callback invocation must pass --evidence-json=');
    assert.ok(slice.includes('--approval='), 'callback invocation must pass --approval=');
    for (const forbidden of ['--seller-url=', '--driver-url=', '--api-url=']) {
      assert.ok(!slice.includes(forbidden), `callback job must never use ${forbidden}`);
    }
    assert.ok(slice.includes('.vercel.app'), 'callback target must be a Preview deployment host');
    assert.ok(slice.includes('greenlove.co.kr'), 'callback job must reject production frontend hosts');
    assert.ok(slice.includes('api-production-'), 'callback job must reject production API hosts');
  });

  it('callback credential input reuses the approved Environment secret name', () => {
    const slice = callbackSlice(readWorkflow());
    assert.ok(
      slice.includes('E2E_TEST_SECRET: ${{ secrets.ROUND_DIRECT_E2E_TEST_SECRET }}'),
      'callback job must map E2E_TEST_SECRET from the approved Environment secret',
    );
    assert.ok(
      slice.includes('TEST_CONSUMER_EMAIL: ${{ secrets.ROUND_DIRECT_E2E_CONSUMER_EMAIL_CHROMIUM }}'),
      'callback job must reuse the approved consumer email secret',
    );
    assert.ok(
      slice.includes('TEST_CONSUMER_PASSWORD: ${{ secrets.ROUND_DIRECT_E2E_CONSUMER_PASSWORD_CHROMIUM }}'),
      'callback job must reuse the approved consumer password secret',
    );
    for (const line of slice.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      if (!/echo|printf/.test(line)) continue;
      for (const sensitive of ['SECRET', 'PASSWORD', 'TOKEN', 'COOKIE', 'SERVICE_ACCOUNT', 'CREDENTIAL_JSON']) {
        assert.ok(
          !line.includes(sensitive),
          `callback log line must not reference ${sensitive}: ${trimmed.slice(0, 120)}`,
        );
      }
    }
    for (const sensitive of ['accessToken', 'refreshToken', 'set-cookie']) {
      assert.ok(!slice.includes(sensitive), `callback job must not handle raw ${sensitive}`);
    }
  });

  it('callback evidence records non-sensitive provenance only', () => {
    const slice = callbackSlice(readWorkflow());
    assert.ok(slice.includes('callback-summary.json'), 'redacted callback summary must be written');
    assert.ok(slice.includes('workflow-summary.json'), 'redacted callback workflow summary must be written');
    assert.ok(slice.includes('credentialSource'), 'provenance wrapper must record credentialSource');
    assert.ok(slice.includes('headerName'), 'provenance wrapper must record headerName');
    assert.ok(slice.includes('headerPresent'), 'provenance wrapper must record headerPresent');
    assert.ok(slice.includes('bindingVerdict'), 'provenance wrapper must record bindingVerdict');
    assert.ok(slice.includes('secretPlaintextAccessed: false'), 'secret non-access must be attested');
    assert.ok(slice.includes('secretDerivedDiagnosticEmitted: false'), 'secret-derived diagnostics must be denied');
    assert.ok(slice.includes('environment: "round-direct-e2e"'), 'environment name must be recorded');
    assert.ok(
      slice.includes('name: auth-callback-probe-'),
      'evidence artifact must use the callback artifact name',
    );
    assert.ok(slice.includes('retention-days: 7'), 'evidence artifact must keep the 7-day retention contract');
  });

  it('deterministic probe-spec and PR triggers cover the callback contract', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('scripts/probe-consumer-callback.spec.mjs'),
      'probe-spec must run the callback deterministic spec',
    );
    assert.ok(
      source.includes('scripts/probe-consumer-callback.workflow.spec.mjs'),
      'probe-spec must run the callback workflow contract spec',
    );
    for (const trigger of [
      'scripts/probe-consumer-callback.mjs',
      'scripts/probe-consumer-callback.spec.mjs',
      'scripts/probe-consumer-callback.workflow.spec.mjs',
    ]) {
      assert.ok(source.includes(trigger), `pull_request paths must include ${trigger}`);
    }
  });

  it('FAIL evidence is projected from probe-raw to callback-summary without null loss', () => {
    const slice = callbackSlice(readWorkflow());
    // Callback-summary projection must preserve the closed FAIL allowlist.
    for (const field of [
      'result: (.result',
      'failureCode: (.failureCode',
      'failureStage: (.failureStage',
      'csrfStatus: (.csrfStatus',
      'httpStatus: (.httpStatus',
      'locationClass: (.locationClass',
      'headerConfigured: (.headerConfigured',
      'headerAttachedByRunner: (.headerAttachedByRunner',
      'protectionPassageMode: (.protectionPassageMode',
      'callbackAttempted: (.callbackAttempted',
      'sessionAttempted: (.sessionAttempted',
      'expectedSha: (.expectedSha',
      'observedDeploymentSha: (.observedDeploymentSha',
    ]) {
      assert.ok(slice.includes(field), `callback-summary must project ${field}`);
    }
    // Success compatibility: existing success shape fields must remain.
    for (const field of [
      'artifact,',
      'authErrorClass,',
      'callbackLocationClass,',
      'callbackStatus,',
      'credentialSource,',
      'headerPresent,',
      'sessionState,',
    ]) {
      assert.ok(slice.includes(field), `callback-summary must preserve success field ${field}`);
    }
    // Protection passage is never created; mode stays NONE.
    assert.ok(slice.includes('protectionPassageMode'), 'protection passage mode must be projected');
    assert.ok(!slice.includes('bypass'), 'callback projection must not introduce bypass');
  });

  it('FAIL evidence is projected from callback-summary to workflow-summary', () => {
    const slice = callbackSlice(readWorkflow());
    for (const field of [
      'result: ($callback[0].result',
      'failureCode: ($callback[0].failureCode',
      'failureStage: ($callback[0].failureStage',
      'csrfStatus: ($callback[0].csrfStatus',
      'httpStatus: ($callback[0].httpStatus',
      'locationClass: ($callback[0].locationClass',
      'headerConfigured: ($callback[0].headerConfigured',
      'headerAttachedByRunner: ($callback[0].headerAttachedByRunner',
      'protectionPassageMode: ($callback[0].protectionPassageMode',
      'callbackAttempted: ($callback[0].callbackAttempted',
      'sessionAttempted: ($callback[0].sessionAttempted',
      'observedDeploymentSha: ($callback[0].observedDeploymentSha',
    ]) {
      assert.ok(slice.includes(field), `workflow-summary must project ${field}`);
    }
    // Success fields and safety attestations must remain.
    for (const field of [
      'bindingVerdict:',
      'credentialSource: ($callback[0].credentialSource',
      'callbackStatus: $callback[0].callbackStatus',
      'authErrorClass: $callback[0].authErrorClass',
      'sessionState: $callback[0].sessionState',
      'secretPlaintextAccessed: false',
      'secretDerivedDiagnosticEmitted: false',
    ]) {
      assert.ok(slice.includes(field), `workflow-summary must preserve ${field}`);
    }
    assert.ok(!slice.includes('bodyIssue'), 'callback scope must not touch session bodyIssue semantics');
    assert.ok(!slice.includes('login-rejection'), 'callback scope must not touch session login-rejection semantics');
  });

  it('callback projection exposes no secret/bypass/protection-passage material', () => {
    const slice = callbackSlice(readWorkflow());
    for (const forbidden of [
      'ROUND_DIRECT_E2E_TEST_SECRET_VALUE',
      'x-e2e-test-token value',
      'Authorization',
      'Set-Cookie',
      '_vercel_jwt',
      'bypass secret',
      'protection passage',
      'Trusted Sources',
    ]) {
      assert.ok(!slice.includes(forbidden), `callback slice must not contain ${forbidden}`);
    }
    // Raw Location values are never projected; only classes are.
    assert.ok(!slice.includes('raw Location'), 'raw Location must never be projected');
    assert.ok(slice.includes('callbackLocationClass'), 'location class must be projected');
    assert.ok(slice.includes('locationClass'), 'FAIL location class must be projected');
  });
});
