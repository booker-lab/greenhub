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

  it('workflow_dispatch exposes the exact six session inputs', () => {
    const source = readWorkflow();
    for (const input of [
      'runner_sha:',
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

  it('deterministic probe-spec installs workspace deps for bcrypt parity', () => {
    const source = readWorkflow();
    const specSlice = jobSlice(source, 'probe-spec:', ['approval_gate:', 'auth_identity_seed:', 'session-probe:']);
    assert.ok(specSlice.includes('pnpm/action-setup'), 'probe-spec must set up pnpm for bcrypt parity');
    assert.ok(specSlice.includes('pnpm install --frozen-lockfile'), 'probe-spec must install deps before bcrypt tests');
  });

  it('round-direct-e2e Environment binds only the runtime probe jobs', () => {
    const source = readWorkflow();
    assert.ok(source.includes('name: round-direct-e2e'), 'session probe must bind round-direct-e2e');
    const specSlice = jobSlice(source, 'probe-spec:', ['approval_gate:', 'auth_identity_seed:', 'session-probe:']);
    assert.ok(
      !specSlice.includes('environment:'),
      'deterministic probe-spec must not bind the credential Environment',
    );
    assert.ok(
      !specSlice.includes('round-direct-e2e'),
      'deterministic probe-spec must not reference the Environment',
    );
    const gateSlice = jobSlice(source, 'approval_gate:', ['auth_identity_seed:']);
    assert.ok(
      !gateSlice.includes('environment:'),
      'approval preflight must not bind the credential Environment',
    );
    // Identity lifecycle jobs bind the same approved Environment; probes
    // keep their existing binding. No new Environment is introduced.
    for (const job of ['auth_identity_seed:', 'session-probe:', 'callback-probe:', 'auth_identity_cleanup:']) {
      const slice = jobSlice(source, job, ['auth_identity_seed:', 'session-probe:', 'callback-probe:', 'auth_identity_cleanup:'].filter((m) => m !== job));
      assert.ok(slice.includes('name: round-direct-e2e'), `${job} must bind round-direct-e2e`);
    }
  });

  it('permissions stay minimal (read-only, no writes)', () => {
    const source = readWorkflow();
    assert.ok(source.includes('contents: read'), 'workflow must keep contents: read');
    for (const forbidden of ['contents: write', 'actions: write', 'packages: write', 'deployments: write']) {
      assert.ok(!source.includes(forbidden), `workflow must not grant ${forbidden}`);
    }
    const gateSlice = jobSlice(source, 'approval_gate:', ['auth_identity_seed:']);
    assert.ok(gateSlice.includes('permissions: {}'), 'approval preflight must use empty permissions');
  });

  it('runner SHA checkout is enforced before any network call', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('ref: ${{ inputs.runner_sha }}'),
      'session probe must checkout the exact runner input SHA',
    );
    assert.ok(
      source.includes('git rev-parse HEAD'),
      'checkout SHA must be compared against the runner SHA',
    );
    assert.ok(
      source.includes('checkout SHA가 runner SHA와 달라 실행을 차단합니다.'),
      'runner checkout mismatch must fail closed with an explicit message',
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
  it('only the allowed scripts are invoked (session + callback + identity lifecycle)', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('scripts/wait-preview-deploy.mjs'),
      'exact target binding must reuse wait-preview-deploy',
    );
    assert.ok(
      source.includes('scripts/probe-auth-runtime.mjs'),
      'runtime probe must invoke only the existing probe runner',
    );
    assert.ok(
      source.includes('scripts/probe-auth-identities.mjs'),
      'identity lifecycle must invoke the owned identity script',
    );
    const invocations = [...source.matchAll(/node\s+scripts\/([^\s'"]+)/g)].map((m) => m[1]);
    assert.ok(invocations.length > 0, 'expected script invocations');
    for (const script of invocations) {
      assert.ok(
        script === 'wait-preview-deploy.mjs' ||
          script === 'probe-auth-runtime.mjs' ||
          script === 'probe-consumer-callback.mjs' ||
          script === 'probe-auth-identities.mjs',
        `forbidden script invocation: node scripts/${script}`,
      );
    }
    // Isolation: the callback runner is invoked only from the callback-probe
    // job, never from the session-probe job (see
    // probe-consumer-callback.workflow.spec.mjs for the job boundary).
    assert.ok(
      source.includes('callback-probe:'),
      'callback invocation must live in the isolated callback-probe job',
    );
    // Identity isolation: seed/cleanup own the identity script; probes never
    // invoke it and identity jobs never invoke probe runners.
    const sessionStart = source.indexOf('session-probe:');
    const callbackStart = source.indexOf('callback-probe:');
    const sessionSlice = source.slice(sessionStart, callbackStart >= 0 ? callbackStart : source.length);
    assert.ok(!sessionSlice.includes('probe-auth-identities.mjs'), 'session job must never invoke the identity script');
    const callbackSlice = source.slice(callbackStart);
    const cleanupStart = callbackSlice.indexOf('auth_identity_cleanup:');
    const callbackOnly = cleanupStart >= 0 ? callbackSlice.slice(0, cleanupStart) : callbackSlice;
    assert.ok(!callbackOnly.includes('probe-auth-identities.mjs'), 'callback job must never invoke the identity script');
  });

  it('production targets are rejected', () => {
    const source = readWorkflow();
    assert.ok(source.includes('greenlove.co.kr'), 'production frontend hosts must be rejected');
    assert.ok(source.includes('api-production-'), 'production API hosts must be rejected');
  });

  it('provider, full-suite, fixture, and service-account paths are scoped', () => {
    const source = readWorkflow();
    // Global forbiddens: never appear anywhere (no full fixture seed, no
    // provider egress, no broad E2E execution, no OIDC writer).
    // NOTE (PILOT-AUTH-VERCEL-AUTOMATION-BYPASS-27): x-vercel-protection-bypass
    // is intentionally ALLOWED but strictly scoped to the callback-probe job
    // only (see scoped assertion below). It must never leak into session,
    // identity, approval, or probe-spec jobs.
    for (const forbidden of [
      'api.portone.io',
      'aligo.in',
      'kauth.kakao.com',
      'kapi.kakao.com',
      'auth/kakao-login',
      'playwright test',
      'round-direct-e2e-fixtures',
      'check-round-direct-e2e-readiness',
      'pnpm --filter e2e',
      'x-vercel-trusted-oidc-idp-token',
      'id-token: write',
    ]) {
      assert.ok(!source.includes(forbidden), `workflow must never contain ${forbidden}`);
    }
    // Automation bypass passage is scoped to the callback-probe job only.
    const sessionStartScoped = source.indexOf('session-probe:');
    const callbackStartScoped = source.indexOf('callback-probe:');
    const cleanupStartScoped = source.indexOf('auth_identity_cleanup:');
    assert.ok(
      sessionStartScoped >= 0 && callbackStartScoped > sessionStartScoped && cleanupStartScoped > callbackStartScoped,
      'lifecycle job order must hold for bypass scoping',
    );
    const callbackOnlyScoped = source.slice(callbackStartScoped, cleanupStartScoped);
    assert.ok(
      callbackOnlyScoped.includes('x-vercel-protection-bypass') ||
        callbackOnlyScoped.includes('VERCEL_AUTOMATION_BYPASS_SECRET') ||
        callbackOnlyScoped.includes('AUTOMATION_BYPASS'),
      'callback-probe must carry the automation bypass passage contract',
    );
    const sessionSliceScoped = source.slice(sessionStartScoped, callbackStartScoped);
    assert.ok(
      !sessionSliceScoped.includes('x-vercel-protection-bypass'),
      'session-probe must never handle the bypass header',
    );
    assert.ok(
      !sessionSliceScoped.includes('ROUND_DIRECT_E2E_CONSUMER_BYPASS_SECRET'),
      'session-probe must never bind the bypass secret',
    );
    assert.ok(
      !sessionSliceScoped.includes('AUTOMATION_BYPASS'),
      'session-probe must never select the bypass passage mode',
    );
    // Service-account material is scoped to identity jobs only; session and
    // callback probes must never handle it.
    const sessionStart = source.indexOf('session-probe:');
    const callbackStart = source.indexOf('callback-probe:');
    const cleanupStart = source.indexOf('auth_identity_cleanup:');
    assert.ok(sessionStart >= 0 && callbackStart > sessionStart && cleanupStart > callbackStart, 'lifecycle job order must hold');
    const sessionSlice = source.slice(sessionStart, callbackStart);
    const callbackOnly = source.slice(callbackStart, cleanupStart);
    assert.ok(!sessionSlice.includes('FIREBASE_SERVICE_ACCOUNT_JSON'), 'session probe must never handle service-account material');
    assert.ok(!callbackOnly.includes('FIREBASE_SERVICE_ACCOUNT_JSON'), 'callback probe must never handle service-account material');
    const seedSlice = source.slice(source.indexOf('auth_identity_seed:'), sessionStart);
    const cleanupSlice = source.slice(cleanupStart);
    assert.ok(seedSlice.includes('FIREBASE_SERVICE_ACCOUNT_JSON'), 'identity seed must bind the approved service-account secret');
    assert.ok(cleanupSlice.includes('FIREBASE_SERVICE_ACCOUNT_JSON'), 'identity cleanup must bind the approved service-account secret');
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

describe('runner/target SHA decoupling (PILOT-AUTH-PROBE-RUNNER-TARGET-SHA-DECOUPLE-17)', () => {
  function sessionSlice(source) {
    const start = source.indexOf('session-probe:');
    assert.ok(start >= 0, 'workflow must contain the session-probe job');
    const end = source.indexOf('callback-probe:');
    return source.slice(start, end >= 0 ? end : source.length);
  }

  it('distinct runner_sha and expected_sha inputs are both required (no equality coupling)', () => {
    const source = readWorkflow();
    const dispatchStart = source.indexOf('workflow_dispatch:');
    const dispatchEnd = source.indexOf('pull_request:');
    assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart, 'workflow must declare dispatch inputs');
    const inputsBlock = source.slice(dispatchStart, dispatchEnd);
    assert.ok(inputsBlock.includes('runner_sha:'), 'workflow_dispatch must declare runner_sha');
    assert.ok(inputsBlock.includes('expected_sha:'), 'workflow_dispatch must declare expected_sha');
    const requiredCount = (inputsBlock.match(/required:\s*true/g) ?? []).length;
    assert.ok(
      requiredCount >= 6,
      `all six session inputs must be required (found ${requiredCount})`,
    );
    for (const line of source.split('\n')) {
      assert.ok(
        !(line.includes('RUNNER_SHA') && line.includes('EXPECTED_SHA')),
        `no step may couple runner and frontend SHAs by equality: ${line.trim().slice(0, 120)}`,
      );
    }
  });

  it('checkout authority is runner_sha, never expected_sha', () => {
    const slice = sessionSlice(readWorkflow());
    assert.ok(
      slice.includes('ref: ${{ inputs.runner_sha }}'),
      'session-probe checkout must follow inputs.runner_sha',
    );
    assert.ok(
      !slice.includes('ref: ${{ inputs.expected_sha }}'),
      'session-probe checkout must never follow inputs.expected_sha',
    );
  });

  it('deployment verifier authority is expected_sha, never runner_sha', () => {
    const slice = sessionSlice(readWorkflow());
    assert.ok(
      slice.includes('--sha="$AUTH_PROBE_EXPECTED_SHA"'),
      'wait-preview-deploy binding must follow the frontend expected SHA',
    );
    assert.ok(
      !slice.includes('--sha="$AUTH_PROBE_RUNNER_SHA"'),
      'deployment verifier must never bind the runner SHA',
    );
    assert.ok(
      slice.includes('--expected-sha="$AUTH_PROBE_EXPECTED_SHA"'),
      'probe runner binding must follow the frontend expected SHA',
    );
  });

  it('malformed runner_sha fails closed', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('if [[ ! "$RUNNER_SHA" =~ ^[0-9a-f]{40}$ ]]'),
      'approval preflight must validate the runner SHA format',
    );
    assert.ok(
      source.includes('if [[ ! "$AUTH_PROBE_RUNNER_SHA" =~ ^[0-9a-f]{40}$ ]]'),
      'session-probe must re-validate the runner SHA format before checkout use',
    );
    assert.ok(
      source.includes('runner SHA는 40자리 소문자 16진수여야 합니다.'),
      'malformed runner SHA must fail closed with an explicit message',
    );
  });

  it('malformed expected_sha fails closed', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]'),
      'approval preflight must validate the frontend SHA format',
    );
    assert.ok(
      source.includes('if [[ ! "$AUTH_PROBE_EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]'),
      'session-probe must re-validate the frontend SHA format',
    );
    assert.ok(
      source.includes('지정 SHA는 40자리 소문자 16진수여야 합니다.'),
      'malformed frontend SHA must fail closed with an explicit message',
    );
  });

  it('runner checkout mismatch fails closed and records the checkout SHA', () => {
    const slice = sessionSlice(readWorkflow());
    assert.ok(
      slice.includes('if [[ "$actual_sha" != "$AUTH_PROBE_RUNNER_SHA" ]]'),
      'checkout SHA must be compared against the runner SHA',
    );
    assert.ok(
      slice.includes('checkout SHA가 runner SHA와 달라 실행을 차단합니다.'),
      'runner checkout mismatch must fail closed with an explicit message',
    );
    assert.ok(
      slice.includes('AUTH_PROBE_CHECKOUT_SHA='),
      'verified checkout SHA must be recorded for evidence',
    );
  });

  it('frontend deployment SHA mismatch still fails closed via exact binding', () => {
    const slice = sessionSlice(readWorkflow());
    assert.ok(
      slice.includes('--sha="$AUTH_PROBE_EXPECTED_SHA"'),
      'deployment binding must keep the exact frontend SHA',
    );
    assert.ok(
      slice.includes('exit "$wait_status"'),
      'deployment verifier exit status must propagate fail-closed',
    );
    assert.ok(
      slice.includes('evidence/deployment.json'),
      'deployment evidence must still be written before the fail-closed exit',
    );
  });

  it('workflow summary separates runner and frontend SHA evidence', () => {
    const slice = sessionSlice(readWorkflow());
    for (const flag of [
      '--arg runnerSha "$AUTH_PROBE_RUNNER_SHA"',
      '--arg expectedSha "$AUTH_PROBE_EXPECTED_SHA"',
      '--arg expectedFrontendSha "$AUTH_PROBE_EXPECTED_SHA"',
      '--arg checkoutSha "$AUTH_PROBE_CHECKOUT_SHA"',
      '--arg workflowSha "$AUTH_PROBE_WORKFLOW_SHA"',
    ]) {
      assert.ok(slice.includes(flag), `workflow summary must bind ${flag}`);
    }
    for (const field of [
      'runnerSha: $runnerSha',
      'expectedSha: $expectedSha',
      'expectedFrontendSha: $expectedFrontendSha',
      'checkoutSha: $checkoutSha',
      'workflowSha: $workflowSha',
      'pinnedDeploymentIds:',
      'deploymentShas:',
      'deploymentTargetUrls:',
    ]) {
      assert.ok(slice.includes(field), `workflow summary must record ${field}`);
    }
  });

  it('new evidence fields leak no secret/token/password/raw body', () => {
    const slice = sessionSlice(readWorkflow());
    for (const line of slice.split('\n')) {
      if (!/runnerSha|checkoutSha|expectedFrontendSha|RUNNER_SHA|CHECKOUT_SHA/.test(line)) continue;
      for (const sensitive of [
        'SECRET',
        'PASSWORD',
        'TOKEN',
        'COOKIE',
        'SERVICE_ACCOUNT',
        'CREDENTIAL_JSON',
        'accessToken',
        'refreshToken',
        'set-cookie',
      ]) {
        assert.ok(
          !line.includes(sensitive),
          `decoupled SHA evidence must not reference ${sensitive}: ${line.trim().slice(0, 120)}`,
        );
      }
    }
    assert.ok(
      !slice.includes('AUTH_PROBE_RUNNER_TOKEN') && !slice.includes('AUTH_PROBE_RUNNER_SECRET'),
      'runner evidence must introduce no new credential-shaped names',
    );
  });
});

describe('auth probe identity lifecycle (PILOT-AUTH-PROBE-IDENTITY-LIFECYCLE-26A)', () => {
  function seedSlice(source) {
    const start = source.indexOf('auth_identity_seed:');
    assert.ok(start >= 0, 'workflow must contain the identity seed job');
    const end = source.indexOf('session-probe:');
    return source.slice(start, end >= 0 ? end : source.length);
  }

  function cleanupSlice(source) {
    const start = source.indexOf('auth_identity_cleanup:');
    assert.ok(start >= 0, 'workflow must contain the identity cleanup job');
    return source.slice(start);
  }

  it('approval → identity → probes → always cleanup dependency holds', () => {
    const source = readWorkflow();
    const seedStart = source.indexOf('auth_identity_seed:');
    const sessionStart = source.indexOf('session-probe:');
    const callbackStart = source.indexOf('callback-probe:');
    const cleanupStart = source.indexOf('auth_identity_cleanup:');
    assert.ok(seedStart >= 0 && sessionStart > seedStart, 'seed must precede session-probe');
    assert.ok(callbackStart > seedStart, 'seed must precede callback-probe');
    assert.ok(cleanupStart > sessionStart && cleanupStart > callbackStart, 'cleanup must follow both probes');
    assert.ok(source.slice(seedStart, sessionStart).includes('needs: approval_gate'), 'seed must need approval_gate');
    assert.ok(source.slice(sessionStart, callbackStart).includes('needs: auth_identity_seed'), 'session must need identity seed');
    const callbackOnly = source.slice(callbackStart, cleanupStart);
    assert.ok(callbackOnly.includes('needs: auth_identity_seed'), 'callback must need identity seed');
    assert.ok(!/^(\s*)needs:.*session-probe/m.test(callbackOnly), 'callback must not depend on session-probe');
    const cleanup = source.slice(cleanupStart);
    assert.ok(cleanup.includes('needs: [auth_identity_seed, session-probe, callback-probe]'), 'cleanup must need seed + both probes');
    assert.ok(cleanup.includes('if: ${{ always()'), 'cleanup must run always()');
  });

  it('identity seed prepares exactly the 3 chromium roles without new secrets', () => {
    const slice = seedSlice(readWorkflow());
    assert.ok(slice.includes('scripts/probe-auth-identities.mjs'), 'seed must invoke the identity script');
    assert.ok(!slice.includes('probe-auth-runtime.mjs'), 'seed must not invoke the session runner');
    assert.ok(!slice.includes('probe-consumer-callback.mjs'), 'seed must not invoke the callback runner');
    for (const name of [
      'ROUND_DIRECT_E2E_CONSUMER_EMAIL_CHROMIUM',
      'ROUND_DIRECT_E2E_CONSUMER_PASSWORD_CHROMIUM',
      'ROUND_DIRECT_E2E_SELLER_EMAIL_CHROMIUM',
      'ROUND_DIRECT_E2E_SELLER_PASSWORD_CHROMIUM',
      'ROUND_DIRECT_E2E_DRIVER_EMAIL_CHROMIUM',
      'ROUND_DIRECT_E2E_DRIVER_PASSWORD_CHROMIUM',
    ]) {
      assert.ok(slice.includes(name), `seed must reuse approved name ${name}`);
    }
    assert.ok(slice.includes('--run-id='), 'seed must pass --run-id=');
    assert.ok(slice.includes('--manifest='), 'seed must pass --manifest=');
    assert.ok(slice.includes('identity-manifest.json'), 'seed must write the redacted identity manifest');
    assert.ok(slice.includes('identity-summary.json'), 'seed must write the non-sensitive identity summary');
  });

  it('identity evidence stays non-sensitive with 7-day retention', () => {
    const seed = seedSlice(readWorkflow());
    const cleanup = cleanupSlice(readWorkflow());
    for (const slice of [seed, cleanup]) {
      for (const line of slice.split('\n')) {
        if (line.trim().startsWith('#')) continue;
        if (!/echo|printf/.test(line)) continue;
        for (const sensitive of ['SECRET', 'PASSWORD', 'TOKEN', 'COOKIE', 'SERVICE_ACCOUNT', 'CREDENTIAL_JSON']) {
          assert.ok(!line.includes(sensitive), `identity log line must not reference ${sensitive}`);
        }
      }
      for (const sensitive of ['passwordHash', 'accessToken', 'refreshToken', 'set-cookie', 'private_key']) {
        assert.ok(!slice.includes(sensitive), `identity job must not handle raw ${sensitive}`);
      }
    }
    assert.ok(seed.includes('auth-probe-identities-'), 'identity artifact must use the lifecycle artifact name');
    assert.ok(cleanup.includes('auth-probe-identities-cleanup-'), 'cleanup artifact must use its own name');
    assert.ok(seed.includes('retention-days: 7'), 'identity evidence must keep the 7-day retention contract');
    assert.ok(cleanup.includes('retention-days: 7'), 'cleanup evidence must keep the 7-day retention contract');
    assert.ok(!seed.includes('bypass'), 'identity seed must not introduce protection bypass');
    assert.ok(!cleanup.includes('bypass'), 'identity cleanup must not introduce protection bypass');
    for (const slice of [seed, cleanup]) {
      assert.ok(
        !slice.includes('ROUND_DIRECT_E2E_CONSUMER_BYPASS_SECRET'),
        'identity jobs must never bind the bypass secret',
      );
      assert.ok(
        !slice.includes('VERCEL_AUTOMATION_BYPASS_SECRET'),
        'identity jobs must never bind the bypass credential env',
      );
      assert.ok(
        !slice.includes('AUTOMATION_BYPASS'),
        'identity jobs must never select the bypass passage mode',
      );
      assert.ok(
        !slice.includes('x-vercel-protection-bypass'),
        'identity jobs must never handle the bypass header',
      );
    }
  });

  it('deterministic probe-spec and PR triggers cover the identity contract', () => {
    const source = readWorkflow();
    assert.ok(source.includes('scripts/probe-auth-identities.spec.mjs'), 'probe-spec must run the identity deterministic spec');
    for (const trigger of ['scripts/probe-auth-identities.mjs', 'scripts/probe-auth-identities.spec.mjs']) {
      assert.ok(source.includes(trigger), `pull_request paths must include ${trigger}`);
    }
  });
});
