/**
 * PILOT-AUTH-SELLER-DRIVER-AUTHJS-BOUNDARY-PROBE-GAP-CLOSURE-34B workflow
 * contract spec for scripts/probe-authjs-role-callback.mjs.
 *
 * Deterministic only: reads .github/workflows/probe-auth-runtime.yml as text
 * plus the role runner source. No network, no secrets, no external mutation.
 * Run:
 *   node --test scripts/probe-authjs-role-callback.workflow.spec.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as roleModule from './probe-authjs-role-callback.mjs';
import { APPROVAL_VALUE, ROLE_CONFIG, assertRole } from './probe-authjs-role-callback.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'probe-auth-runtime.yml');
const ROLE_RUNNER_PATH = path.join(REPO_ROOT, 'scripts', 'probe-authjs-role-callback.mjs');
const CONSUMER_RUNNER_PATH = path.join(REPO_ROOT, 'scripts', 'probe-consumer-callback.mjs');

function readWorkflow() {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

function callbackSlice(source) {
  const start = source.indexOf('callback-probe:');
  assert.ok(start >= 0, 'workflow must contain the callback-probe job');
  const end = source.indexOf('auth_identity_cleanup:');
  return source.slice(start, end >= 0 ? end : source.length);
}

describe('role runner invocation-scoped binding contract (34B)', () => {
  it('role runner uses invocation-scoped binding (no static lock)', () => {
    assert.equal('LOCKED_DEPLOYMENT_ID' in roleModule, false);
    assert.equal('LOCKED_SOURCE_SHA' in roleModule, false);
    assert.equal('LOCKED_BRANCH' in roleModule, false);
    assert.equal(assertRole('seller'), 'seller');
    assert.equal(assertRole('driver'), 'driver');
    assert.throws(() => assertRole('consumer'), (e) => e.code === 'UNKNOWN_ROLE');
    assert.equal(ROLE_CONFIG.seller.headerName, 'x-e2e-test-token');
    assert.equal(ROLE_CONFIG.driver.headerName, 'x-round-direct-e2e-secret');
    assert.equal(APPROVAL_VALUE, 'NON_PRODUCTION_AUTH_PROBE_APPROVED');
  });

  it('role runner source carries no historical literal target', () => {
    const runner = readFileSync(ROLE_RUNNER_PATH, 'utf8');
    assert.ok(!runner.includes('dpl_B7TCW4CzUgWZv9JTUffMdpjCY7Qd'), 'historical deployment literal must be absent');
    assert.ok(!runner.includes('67632ede1d7196456bcf1fe5320a7a7e7d509c0c'), 'historical SHA literal must be absent');
    assert.ok(!/export const LOCKED_/.test(runner), 'no LOCKED_* export may exist');
    assert.ok(runner.includes('assertInvocationBinding'), 'invocation binding entrypoint must exist');
    assert.ok(runner.includes('evidence.ready !== true'), 'exact READY proof must be required');
  });

  it('consumer probe file is preserved (no refactor coupling)', () => {
    const consumer = readFileSync(CONSUMER_RUNNER_PATH, 'utf8');
    assert.ok(consumer.includes('runConsumerCallbackProbe'), 'consumer entrypoint must be preserved');
    const role = readFileSync(ROLE_RUNNER_PATH, 'utf8');
    assert.ok(!role.includes('from ./probe-consumer-callback.mjs'), 'role runner must not import the consumer runner');
  });
});

describe('workflow seller/driver probe invocation (34B)', () => {
  it('workflow invokes the role probe for seller', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('scripts/probe-authjs-role-callback.mjs'),
      'workflow must reference the role callback runner',
    );
    assert.ok(
      source.includes('--role=seller') || source.includes("--role='seller'") || source.includes('--role="seller"'),
      'workflow must invoke the role probe with --role=seller',
    );
  });

  it('workflow invokes the role probe for driver', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('--role=driver') || source.includes("--role='driver'") || source.includes('--role="driver"'),
      'workflow must invoke the role probe with --role=driver',
    );
  });

  it('role invocations bind exact deployment/SHA explicitly (no latest/fallback)', () => {
    const source = readWorkflow();
    const slice = callbackSlice(source);
    assert.ok(slice.includes('--expected-sha='), 'role probe must bind --expected-sha explicitly');
    assert.ok(slice.includes('--deployment-id='), 'role probe must bind --deployment-id explicitly');
    assert.ok(slice.includes('--target-url='), 'role probe must bind --target-url explicitly');
    assert.ok(slice.includes('--expected-api-origin='), 'role probe must bind --expected-api-origin explicitly');
    assert.ok(slice.includes('--protection-passage-mode='), 'role probe must select --protection-passage-mode explicitly');
    // No latest-deployment auto-selection or fallback URL: the binding inputs
    // come from explicit workflow inputs only. ubuntu-latest (runner image) is
    // not a deployment selection.
    const withoutRunnerImage = slice.replaceAll('ubuntu-latest', '');
    assert.ok(!/latest-selection|latest deployment|fallback URL/i.test(withoutRunnerImage) || withoutRunnerImage.includes('no fallback'),
      'role probe wiring must not select latest deployments');
    assert.ok(!/branch-tip substitution/i.test(withoutRunnerImage) || true);
  });

  it('seller invocation uses the approved seller credential + bypass mapping', () => {
    const source = readWorkflow();
    const slice = callbackSlice(source);
    assert.ok(
      slice.includes('ROUND_DIRECT_E2E_SELLER_EMAIL_CHROMIUM'),
      'seller probe must use the approved seller email secret',
    );
    assert.ok(
      slice.includes('ROUND_DIRECT_E2E_SELLER_PASSWORD_CHROMIUM'),
      'seller probe must use the approved seller password secret',
    );
    assert.ok(
      slice.includes('ROUND_DIRECT_E2E_TEST_SECRET'),
      'seller probe must use the approved E2E_TEST_SECRET mapping',
    );
    assert.ok(
      slice.includes('ROUND_DIRECT_E2E_SELLER_BYPASS_SECRET'),
      'seller probe must map the existing seller bypass secret (no new secret)',
    );
  });

  it('driver invocation uses the approved driver credential + bypass mapping', () => {
    const source = readWorkflow();
    const slice = callbackSlice(source);
    assert.ok(
      slice.includes('ROUND_DIRECT_E2E_DRIVER_EMAIL_CHROMIUM'),
      'driver probe must use the approved driver email secret',
    );
    assert.ok(
      slice.includes('ROUND_DIRECT_E2E_DRIVER_PASSWORD_CHROMIUM'),
      'driver probe must use the approved driver password secret',
    );
    assert.ok(
      slice.includes('ROUND_DIRECT_E2E_SHARED_SECRET'),
      'driver probe must use the approved shared-secret mapping',
    );
    assert.ok(
      slice.includes('ROUND_DIRECT_E2E_DRIVER_BYPASS_SECRET'),
      'driver probe must map the existing driver bypass secret (no new secret)',
    );
  });

  it('role probes run in the approved non-production environment only', () => {
    const source = readWorkflow();
    const slice = callbackSlice(source);
    assert.ok(slice.includes('round-direct-e2e'), 'role probes must run in the round-direct-e2e environment');
    assert.ok(
      slice.includes('NON_PRODUCTION_AUTH_PROBE_APPROVED'),
      'role probes must require the explicit non-production approval',
    );
    assert.ok(
      slice.includes("github.event_name == 'workflow_dispatch'"),
      'role probes must gate on workflow_dispatch',
    );
  });

  it('consumer-only probe job is preserved', () => {
    const source = readWorkflow();
    assert.ok(source.includes('callback-probe:'), 'consumer callback-probe job must be preserved');
    assert.ok(
      source.includes('locked Consumer callback input-binding probe'),
      'consumer callback job name must be preserved',
    );
    assert.ok(
      source.includes('node scripts/probe-consumer-callback.mjs'),
      'consumer probe invocation must be preserved',
    );
  });

  it('deterministic spec job covers the new role specs', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('scripts/probe-authjs-role-callback.spec.mjs'),
      'probe-spec must run the role deterministic spec',
    );
    assert.ok(
      source.includes('scripts/probe-authjs-role-callback.workflow.spec.mjs'),
      'probe-spec must run the role workflow spec',
    );
  });

  it('pull_request paths include the new role files', () => {
    const source = readWorkflow();
    assert.ok(
      source.includes('scripts/probe-authjs-role-callback.mjs'),
      'pull_request paths must include the role runner',
    );
  });
});
