import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARTIFACT_KEYS,
  DRIVER_AUTHORIZE_GATE_CLASSES,
  DRIVER_GATE_CODE_TO_GATE_CLASS,
  PRE_UPSTREAM_DIAGNOSTIC_CODES,
  buildRoleArtifact,
  classifyAuthError,
  parseDriverAuthorizeGateClass,
  parsePreUpstreamDiagnosticCode,
  resolveDriverGateClass,
} from './probe-authjs-role-callback.mjs';

const DRIVER_CODES = Object.freeze([
  ['authorize-rejected__driver-g2-enabled', 'RUNTIME_DISABLED'],
  ['authorize-rejected__driver-g3-secret-mismatch', 'APP_SECRET_GATE_REJECTED'],
  ['authorize-rejected__driver-g4-allowlist-rejected', 'DRIVER_ALLOWLIST_REJECTED'],
  ['authorize-rejected__driver-g5-credential-shape-rejected', 'CREDENTIAL_SHAPE_REJECTED'],
  ['authorize-rejected__driver-g6-upstream-dispatch-failed', 'UPSTREAM_DISPATCH_FAILED'],
  ['authorize-rejected__driver-g7-upstream-non-ok', 'UPSTREAM_NON_OK'],
  ['authorize-rejected__driver-g8-upstream-response-invalid', 'UPSTREAM_RESPONSE_INVALID'],
  ['authorize-rejected__driver-g9-role-rejected', 'ROLE_REJECTED'],
  ['authorize-rejected__driver-g10-approval-rejected', 'APPROVAL_REJECTED'],
]);

describe('38B driver gateClass diagnostic (probe parser)', () => {
  it('contract enum is closed (11) and mapping covers 9 rejection codes', () => {
    assert.equal(DRIVER_AUTHORIZE_GATE_CLASSES.length, 11);
    for (const required of [
      'RUNTIME_DISABLED',
      'APP_SECRET_GATE_REJECTED',
      'DRIVER_ALLOWLIST_REJECTED',
      'CREDENTIAL_SHAPE_REJECTED',
      'API_BASE_UNRESOLVED',
      'UPSTREAM_DISPATCH_FAILED',
      'UPSTREAM_NON_OK',
      'UPSTREAM_RESPONSE_INVALID',
      'ROLE_REJECTED',
      'APPROVAL_REJECTED',
      'AUTHORIZED',
    ]) {
      assert.ok(DRIVER_AUTHORIZE_GATE_CLASSES.includes(required), `missing ${required}`);
    }
    assert.equal(Object.keys(DRIVER_GATE_CODE_TO_GATE_CLASS).length, 9);
    // API_BASE_UNRESOLVED and AUTHORIZED never come from a code.
    assert.ok(!Object.values(DRIVER_GATE_CODE_TO_GATE_CLASS).includes('API_BASE_UNRESOLVED'));
    assert.ok(!Object.values(DRIVER_GATE_CODE_TO_GATE_CLASS).includes('AUTHORIZED'));
    // DISPATCH vs NON_OK are distinct codes mapping to distinct gates.
    assert.notEqual(
      DRIVER_GATE_CODE_TO_GATE_CLASS['authorize-rejected__driver-g6-upstream-dispatch-failed'],
      DRIVER_GATE_CODE_TO_GATE_CLASS['authorize-rejected__driver-g7-upstream-non-ok'],
    );
  });

  it('all 9 driver codes pass through verbatim and keep authorize-rejected top-level', () => {
    for (const [code] of DRIVER_CODES) {
      assert.ok(PRE_UPSTREAM_DIAGNOSTIC_CODES.includes(code), `${code} must be allowlisted`);
      const parsed = parsePreUpstreamDiagnosticCode(code);
      assert.ok(parsed, `${code} must parse`);
      assert.equal(parsed.diagnosticCode, code);
      assert.equal(classifyAuthError({ status: 302, codeParam: code, errorParam: 'CredentialsSignin' }), 'authorize-rejected');
    }
  });

  it('each driver code resolves to exactly one gate class', () => {
    for (const [code, gate] of DRIVER_CODES) {
      assert.equal(parseDriverAuthorizeGateClass(code), gate);
      assert.equal(
        resolveDriverGateClass({ role: 'driver', codeParam: code, errorParam: 'CredentialsSignin', locationClass: 'LOGIN_ERROR' }),
        gate,
      );
    }
  });

  it('AUTHORIZED is inferred only on driver ROOT success with no error', () => {
    assert.equal(
      resolveDriverGateClass({ role: 'driver', codeParam: null, errorParam: null, locationClass: 'ROOT' }),
      'AUTHORIZED',
    );
    // LOGIN_ERROR with no code is incomplete, never fabricated as AUTHORIZED.
    assert.equal(
      resolveDriverGateClass({ role: 'driver', codeParam: null, errorParam: 'CredentialsSignin', locationClass: 'LOGIN_ERROR' }),
      null,
    );
    assert.equal(
      resolveDriverGateClass({ role: 'driver', codeParam: 'unknown', errorParam: 'CredentialsSignin', locationClass: 'LOGIN_ERROR' }),
      null,
    );
    assert.equal(
      resolveDriverGateClass({ role: 'driver', codeParam: null, errorParam: null, locationClass: 'OTHER' }),
      null,
    );
  });

  it('seller never carries a driver gate (diagnostic disabled path)', () => {
    for (const [code] of DRIVER_CODES) {
      assert.equal(
        resolveDriverGateClass({ role: 'seller', codeParam: code, errorParam: 'CredentialsSignin', locationClass: 'LOGIN_ERROR' }),
        null,
      );
    }
    assert.equal(
      resolveDriverGateClass({ role: 'seller', codeParam: null, errorParam: null, locationClass: 'ROOT' }),
      null,
    );
  });

  it('artifact carries gateClass (closed enum or null) without secret material', () => {
    assert.ok(ARTIFACT_KEYS.includes('gateClass'), 'ARTIFACT_KEYS must include gateClass');
    const base = {
      role: 'driver',
      authErrorClass: 'authorize-rejected',
      callbackLocationClass: 'LOGIN_ERROR',
      callbackStatus: 302,
      checkedAt: '2026-09-14T00:00:00.000Z',
      deploymentId: 'dpl_0123456789abcdef',
      deploymentSourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headerPresent: true,
      preUpstreamDiagnosticCode: 'authorize-rejected__driver-g7-upstream-non-ok',
      gateClass: 'UPSTREAM_NON_OK',
      sessionContract: 'NOT_CHECKED',
      sessionState: 'INVALID',
      setCookiePresent: false,
      workflowSourceSha: 'local-unpublished',
    };
    const artifact = buildRoleArtifact(base);
    assert.equal(artifact.gateClass, 'UPSTREAM_NON_OK');
    assert.equal(artifact.preUpstreamDiagnosticCode, 'authorize-rejected__driver-g7-upstream-non-ok');
    assert.deepEqual(Object.keys(artifact).sort(), [...ARTIFACT_KEYS].sort());
    const serialized = JSON.stringify(artifact);
    // credentialSource/headerName key NAMES (e.g. ROUND_DIRECT_E2E_SHARED_SECRET)
    // are provenance metadata by design (values never enter evidence).
    // Forbid actual values/tokens/cookies/emails, not key names.
    for (const forbidden of ['dpl_0123456789abcdef']) {
      assert.ok(serialized.includes(forbidden), 'sanity: artifact contains expected fixture id');
    }
    assert.ok(!serialized.includes('driver-38b@example.test'), 'artifact must not contain email values');
    assert.ok(!serialized.includes('pw-38b'), 'artifact must not contain password values');
    // Invalid gateClass fails closed.
    assert.throws(() => buildRoleArtifact({ ...base, gateClass: 'NOT_A_GATE' }), /gateClass/);
    assert.throws(() => buildRoleArtifact({ ...base, role: 'seller', gateClass: 'UPSTREAM_NON_OK' }), /driver/);
  });

  it('non-driver and null gates stay null (no fabrication)', () => {
    const sellerArtifact = buildRoleArtifact({
      role: 'seller',
      authErrorClass: 'authorize-rejected',
      callbackLocationClass: 'LOGIN_ERROR',
      callbackStatus: 302,
      checkedAt: '2026-09-14T00:00:00.000Z',
      deploymentId: 'dpl_0123456789abcdef',
      deploymentSourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headerPresent: true,
      preUpstreamDiagnosticCode: null,
      gateClass: null,
      sessionContract: 'NOT_CHECKED',
      sessionState: 'INVALID',
      setCookiePresent: false,
      workflowSourceSha: 'local-unpublished',
    });
    assert.equal(sellerArtifact.gateClass, null);
  });
});
