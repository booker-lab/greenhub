/**
 * PILOT-AUTH-SESSION-ONLY-WORKFLOW-14 — session-only workflow contract spec.
 *
 * Deterministic only: reads .github/workflows/probe-auth-runtime.yml as text
 * plus the runner's canonical APPROVAL_VALUE. No network, no secrets, no
 * external mutation. Run:
 *   node --test scripts/probe-auth-runtime.workflow.spec.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { APPROVAL_VALUE } from './probe-auth-runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'probe-auth-runtime.yml');

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

describe('session-only workflow dispatch contract', () => {
  it('canonical probe approval value is reused (no new approval string)', () => {
    assert.equal(APPROVAL_VALUE, 'NON_PRODUCTION_AUTH_PROBE_APPROVED');
    const source = readWorkflow();
    assert.ok(
      source.includes(APPROVAL_VALUE),
      'workflow must reuse the runner canonical approval value',
    );
    assert.ok(
      !source.includes('NON_PRODUCTION_E2E_APPROVED'),
      'session-only probe must not reuse the full-E2E approval value',
    );
  });

  it('workflow_dispatch exposes the exact five session inputs', () => {
    const source = readWorkflow();
    for (const input of [
      'expected_sha:',
      'consumer_deployment_id:',
      'seller_deployment_id:',
      'driver_deployment_id:',
      'approval:',
    ]) {
      assert.ok(source.includes(input), `workflow_dispatch must declare ${input}`);
    }
  });

  it('real probe runs on manual dispatch only', () => {
    const source = readWorkflow();
    const guards = source.match(/github\.event_name == 'workflow_dispatch'/g) ?? [];
    assert.ok(
      guards.length >= 2,
      'approval_gate and session-probe must both gate on workflow_dispatch',
    );
    assert.ok(
      source.includes('workflow_dispatch 이외의 이벤트에서는'),
      'non-dispatch events must fail closed with an explicit message',
    );
  });

  it('round-direct-e2e Environment binds only the session probe', () => {
    const source = readWorkflow();
    assert.ok(source.includes('name: round-direct-e2e'), 'session probe must bind round-direct-e2e');
    const specSlice = jobSlice(source, 'probe-spec:', ['approval_gate:', 'session-probe:']);
    assert.ok(
      !specSlice.includes('environment:'),
      'deterministic probe-spec must not bind the credential Environment',
    );
    assert.ok(
      !specSlice.includes('round-direct-e2e'),
      'deterministic probe-spec must not reference the Environment',
    );
    const gateSlice = jobSlice(source, 'approval_gate:', ['session-probe:']);
    assert.ok(
      !gateSlice.includes('environment:'),
      'approval preflight must not bind the credential Environment',
    );
  });

  it('permissions stay minimal (read-only, no writes)', () => {
    const source = readWorkflow();
    assert.ok(source.includes('contents: read'), 'workflow must keep contents: read');
    for (const forbidden of ['contents: write', 'actions: write', 'packages: write', 'deployments: write']) {
      assert.ok(!source.includes(forbidden), `workflow must not grant ${forbidden}`);
    }
    const gateSlice = jobSlice(source, 'approval_gate:', ['session-probe:']);
    assert.ok(gateSlice.includes('permissions: {}'), 'approval preflight must use empty permissions');
  });

  it('exact SHA checkout is enforced before any network call', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('ref: ${{ inputs.expected_sha }}'),
      'session probe must checkout the exact input SHA',
    );
    assert.ok(
      source.includes('git rev-parse HEAD'),
      'checkout SHA must be compared against the input SHA',
    );
    assert.ok(
      source.includes('checkout SHA가 지정 SHA와 달라 실행을 차단합니다.'),
      'SHA mismatch must fail closed with an explicit message',
    );
  });

  it('three pinned deployment IDs are validated and bound', () => {
    const source = readWorkflow();
    assert.ok(source.includes('^dpl_[A-Za-z0-9]+$'), 'deployment IDs must match the pinned dpl_ format');
    for (const flag of ['--consumer-deployment-id=', '--seller-deployment-id=', '--driver-deployment-id=']) {
      assert.ok(source.includes(flag), `deployment binding must pass ${flag}`);
    }
    assert.ok(source.includes('--sha='), 'deployment binding must pass the expected SHA');
  });
});

describe('session-only runtime boundary', () => {
  it('only the two allowed scripts are invoked', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('scripts/wait-preview-deploy.mjs'),
      'exact target binding must reuse wait-preview-deploy',
    );
    assert.ok(
      source.includes('scripts/probe-auth-runtime.mjs'),
      'runtime probe must invoke only the existing probe runner',
    );
    const invocations = [...source.matchAll(/node\s+scripts\/([^\s'"]+)/g)].map((m) => m[1]);
    assert.ok(invocations.length > 0, 'expected script invocations');
    for (const script of invocations) {
      assert.ok(
        script === 'wait-preview-deploy.mjs' || script === 'probe-auth-runtime.mjs',
        `forbidden script invocation: node scripts/${script}`,
      );
    }
  });

  it('production targets are rejected', () => {
    const source = readWorkflow();
    assert.ok(source.includes('greenlove.co.kr'), 'production frontend hosts must be rejected');
    assert.ok(source.includes('api-production-'), 'production API hosts must be rejected');
  });

  it('provider, full-suite, fixture, and service-account paths are never invoked', () => {
    const source = readWorkflow();
    for (const forbidden of [
      'api.portone.io',
      'aligo.in',
      'kauth.kakao.com',
      'kapi.kakao.com',
      'auth/kakao-login',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'playwright test',
      'round-direct-e2e-fixtures',
      'check-round-direct-e2e-readiness',
      'pnpm --filter e2e',
    ]) {
      assert.ok(!source.includes(forbidden), `workflow must never contain ${forbidden}`);
    }
  });

  it('probe CLI passes only non-secret binding flags', () => {
    const source = readWorkflow();
    for (const flag of [
      '--expected-sha=',
      '--consumer-url=',
      '--seller-url=',
      '--driver-url=',
      '--api-url=',
      '--evidence-json=',
      '--approval=',
    ]) {
      assert.ok(source.includes(flag), `probe invocation must pass ${flag}`);
    }
  });

  it('secret values are never logged and evidence stays non-secret', () => {
    const source = readWorkflow();
    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;
      if (!/echo|printf/.test(line)) continue;
      for (const sensitive of ['SECRET', 'PASSWORD', 'TOKEN', 'COOKIE', 'SERVICE_ACCOUNT', 'CREDENTIAL_JSON']) {
        assert.ok(
          !line.includes(sensitive),
          `log line must not reference ${sensitive}: ${trimmed.slice(0, 120)}`,
        );
      }
    }
    for (const sensitive of ['accessToken', 'refreshToken', 'set-cookie']) {
      assert.ok(!source.includes(sensitive), `workflow must not handle raw ${sensitive}`);
    }
    assert.ok(source.includes('probe-summary.json'), 'redacted probe summary must be written');
    assert.ok(source.includes('workflow-summary.json'), 'redacted workflow summary must be written');
    assert.ok(
      source.includes('NEGATIVE_IDENTITY_NOT_CONFIGURED'),
      'missing negative fixture must be recorded explicitly, not faked',
    );
  });

  it('approved Environment secret/var names are reused (no new credentials)', () => {
    const source = readWorkflow();
    for (const name of [
      'ROUND_DIRECT_E2E_VERCEL_READ_TOKEN',
      'ROUND_DIRECT_E2E_TEST_SECRET',
      'ROUND_DIRECT_E2E_SHARED_SECRET',
      'ROUND_DIRECT_E2E_CONSUMER_EMAIL_CHROMIUM',
      'ROUND_DIRECT_E2E_CONSUMER_PASSWORD_CHROMIUM',
      'ROUND_DIRECT_E2E_SELLER_EMAIL_CHROMIUM',
      'ROUND_DIRECT_E2E_SELLER_PASSWORD_CHROMIUM',
      'ROUND_DIRECT_E2E_DRIVER_EMAIL_CHROMIUM',
      'ROUND_DIRECT_E2E_DRIVER_PASSWORD_CHROMIUM',
      'ROUND_DIRECT_E2E_API_ORIGIN',
      'ROUND_DIRECT_E2E_ALLOWED_API_ORIGINS',
      'ROUND_DIRECT_E2E_FIREBASE_PROJECT_ID',
    ]) {
      assert.ok(source.includes(name), `workflow must reuse approved name ${name}`);
    }
    assert.ok(
      source.includes('retention-days: 7'),
      'evidence artifact must keep the 7-day retention contract',
    );
    assert.ok(
      source.includes('auth-session-probe-'),
      'evidence artifact must use the session-only artifact name',
    );
  });
});
