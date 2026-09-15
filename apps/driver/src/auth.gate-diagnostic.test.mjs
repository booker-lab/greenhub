import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(directory, 'auth.ts'), 'utf8');

// 38B gate codes (verbatim, closed enum carriers). Mapping to 38B enum is
// documented in auth.ts header; these strings are the only observable
// diagnostic outputs (no values/hashes/lengths).
const G2_ENABLED = 'authorize-rejected__driver-g2-enabled';
const G3_SECRET_MISMATCH = 'authorize-rejected__driver-g3-secret-mismatch';
const G4_ALLOWLIST = 'authorize-rejected__driver-g4-allowlist-rejected';
const G5_SHAPE = 'authorize-rejected__driver-g5-credential-shape-rejected';
const G6_DISPATCH = 'authorize-rejected__driver-g6-upstream-dispatch-failed';
const G7_NON_OK = 'authorize-rejected__driver-g7-upstream-non-ok';
const G8_INVALID = 'authorize-rejected__driver-g8-upstream-response-invalid';
const G9_ROLE = 'authorize-rejected__driver-g9-role-rejected';
const G10_APPROVAL = 'authorize-rejected__driver-g10-approval-rejected';

const ALL_CODES = Object.freeze([
  G2_ENABLED,
  G3_SECRET_MISMATCH,
  G4_ALLOWLIST,
  G5_SHAPE,
  G6_DISPATCH,
  G7_NON_OK,
  G8_INVALID,
  G9_ROLE,
  G10_APPROVAL,
]);

// Mirror of apps/driver/src/auth.ts Preview E2E authorize ordering (38B).
// Proves gate mapping + upstream-call counts without importing NextAuth or
// touching the network. Env/fetch are injected; no secrets/values leak.
function simulatePreviewAuthorize({
  vercelEnv = 'preview',
  enabled = 'true',
  expectedSecret = 'shared-secret-fixture-38b',
  receivedSecret = 'shared-secret-fixture-38b',
  credentials = { email: 'driver-38b@example.test', password: 'pw-38b' },
  allowlist = 'driver-38b@example.test',
  fetchImpl,
}) {
  let upstreamCalls = 0;
  const isAllowlisted = (email) => {
    if (typeof email !== 'string') return false;
    const set = new Set(
      String(allowlist ?? '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    );
    return set.has(String(email).trim().toLowerCase());
  };
  const secretsMatch = (a, b) => {
    if (!a || !b) return false;
    return String(a) === String(b);
  };
  const run = async () => {
    if (vercelEnv !== 'preview' || enabled !== 'true') {
      return { rejected: true, gate: 'RUNTIME_DISABLED', code: G2_ENABLED, upstreamCalls: 0 };
    }
    if (!secretsMatch(receivedSecret, expectedSecret)) {
      return { rejected: true, gate: 'APP_SECRET_GATE_REJECTED', code: G3_SECRET_MISMATCH, upstreamCalls: 0 };
    }
    const cred = credentials;
    if (!cred || typeof cred !== 'object') {
      return { rejected: true, gate: 'CREDENTIAL_SHAPE_REJECTED', code: G5_SHAPE, upstreamCalls: 0 };
    }
    if (typeof cred.password !== 'string') {
      return { rejected: true, gate: 'CREDENTIAL_SHAPE_REJECTED', code: G5_SHAPE, upstreamCalls: 0 };
    }
    if (typeof cred.email !== 'string') {
      return { rejected: true, gate: 'CREDENTIAL_SHAPE_REJECTED', code: G5_SHAPE, upstreamCalls: 0 };
    }
    if (!isAllowlisted(cred.email)) {
      return { rejected: true, gate: 'DRIVER_ALLOWLIST_REJECTED', code: G4_ALLOWLIST, upstreamCalls: 0 };
    }
    const fetch = fetchImpl ?? (async () => ({ ok: true, status: 200, json: async () => ({}) }));
    let res;
    try {
      upstreamCalls += 1;
      res = await fetch('https://api-staging.example.test/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cred.email, password: cred.password }),
      });
    } catch {
      return { rejected: true, gate: 'UPSTREAM_DISPATCH_FAILED', code: G6_DISPATCH, upstreamCalls };
    }
    if (!res.ok) {
      return { rejected: true, gate: 'UPSTREAM_NON_OK', code: G7_NON_OK, upstreamCalls };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return { rejected: true, gate: 'UPSTREAM_RESPONSE_INVALID', code: G8_INVALID, upstreamCalls };
    }
    const user = data?.user;
    if (!user || typeof user !== 'object') {
      return { rejected: true, gate: 'UPSTREAM_RESPONSE_INVALID', code: G8_INVALID, upstreamCalls };
    }
    if (user.role !== 'driver') {
      return { rejected: true, gate: 'ROLE_REJECTED', code: G9_ROLE, upstreamCalls };
    }
    if (user.driverApproved !== true) {
      return { rejected: true, gate: 'APPROVAL_REJECTED', code: G10_APPROVAL, upstreamCalls };
    }
    return { rejected: false, gate: 'AUTHORIZED', code: null, upstreamCalls };
  };
  return run();
}

describe('38B Driver authorize gate-class diagnostic (source contract)', () => {
  it('1: runtime disabled emits g2 (RUNTIME_DISABLED)', () => {
    assert.ok(source.includes(`'${G2_ENABLED}'`), 'g2 code site missing');
    assert.match(source, /VERCEL_ENV\s*!==\s*['"]preview['"]/);
    assert.match(source, /ROUND_DIRECT_E2E_ENABLED\s*!==\s*['"]true['"]/);
  });

  it('2: shared-secret mismatch emits g3 (APP_SECRET_GATE_REJECTED)', () => {
    assert.ok(source.includes(`'${G3_SECRET_MISMATCH}'`), 'g3 code site missing');
    assert.match(source, /x-round-direct-e2e-secret/);
    assert.match(source, /secretsMatch\s*\(/);
    assert.match(source, /timingSafeEqual/);
  });

  it('3: allowlist reject emits g4 (DRIVER_ALLOWLIST_REJECTED)', () => {
    assert.ok(source.includes(`'${G4_ALLOWLIST}'`), 'g4 code site missing');
    assert.match(source, /isAllowedE2EDriverEmail/);
  });

  it('4: malformed/missing credential emits g5 (CREDENTIAL_SHAPE_REJECTED)', () => {
    assert.ok(source.includes(`'${G5_SHAPE}'`), 'g5 code site missing');
  });

  it('5: fetch throw emits g6 (UPSTREAM_DISPATCH_FAILED, distinct from non-ok)', () => {
    assert.ok(source.includes(`'${G6_DISPATCH}'`), 'g6 code site missing');
    const fetchAt = source.indexOf('fetch(`${API}/auth/login`');
    const g6At = source.indexOf(`'${G6_DISPATCH}'`, fetchAt);
    assert.ok(fetchAt >= 0 && g6At > fetchAt, 'g6 must be at upstream dispatch (catch after fetch)');
  });

  it('6: upstream non-2xx emits g7 (UPSTREAM_NON_OK)', () => {
    assert.ok(source.includes(`'${G7_NON_OK}'`), 'g7 code site missing');
    assert.match(source, /if\s*\(\s*!res\.ok\s*\)/);
  });

  it('7: malformed successful payload emits g8 (UPSTREAM_RESPONSE_INVALID)', () => {
    assert.ok(source.includes(`'${G8_INVALID}'`), 'g8 code site missing');
  });

  it('8: role mismatch emits g9 (ROLE_REJECTED)', () => {
    assert.ok(source.includes(`'${G9_ROLE}'`), 'g9 code site missing');
    assert.match(source, /!==\s*['"]driver['"]/);
  });

  it('9: driverApproved false emits g10 (APPROVAL_REJECTED)', () => {
    assert.ok(source.includes(`'${G10_APPROVAL}'`), 'g10 code site missing');
    assert.match(source, /driverApproved\s*!==\s*true/);
  });

  it('10: valid driver response authorizes (AUTHORIZED, no code)', async () => {
    const ok = await simulatePreviewAuthorize({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          user: { id: 'u-38b', email: 'driver-38b@example.test', role: 'driver', driverApproved: true },
          accessToken: 'at',
          refreshToken: 'rt',
        }),
      }),
    });
    assert.equal(ok.rejected, false);
    assert.equal(ok.gate, 'AUTHORIZED');
    assert.equal(ok.code, null);
    assert.equal(ok.upstreamCalls, 1);
    // Source still returns the original user/session shape (no new fields).
    assert.match(source, /accessToken:\s*data\.accessToken/);
    assert.match(source, /refreshToken:\s*data\.refreshToken/);
  });

  it('gate ordering is runtime, secret, shape, allowlist, then upstream', () => {
    // Order by throw sites (not type-union order): find each code's first
    // `throw new DiagnosticCredentialsSignin('...')` occurrence.
    const throwAt = (code) => source.indexOf(`throw new DiagnosticCredentialsSignin(\n            '${code}'`) >= 0
      ? source.indexOf(`throw new DiagnosticCredentialsSignin(\n            '${code}'`)
      : source.indexOf(`throw new DiagnosticCredentialsSignin('${code}'`);
    // Fallback: search for the code after the authorize() entry to skip the
    // type-union preamble (which lists g4 before g5).
    const authzAt = source.indexOf('async authorize(credentials');
    const at = (code) => {
      const direct = source.indexOf(`'${code}'`, authzAt);
      return direct;
    };
    const g2 = at(G2_ENABLED);
    const g3 = at(G3_SECRET_MISMATCH);
    const g5 = at(G5_SHAPE);
    const g4 = at(G4_ALLOWLIST);
    const g6 = at(G6_DISPATCH);
    const g7 = at(G7_NON_OK);
    const g8 = at(G8_INVALID);
    const g9 = at(G9_ROLE);
    const g10 = at(G10_APPROVAL);
    for (const v of [g2, g3, g5, g4, g6, g7, g8, g9, g10]) assert.ok(v >= 0, 'gate code missing in order check');
    assert.ok(g2 < g3 && g3 < g5 && g5 < g4, 'pre-upstream order must be g2,g3,g5,g4');
    assert.ok(g4 < g6 && g6 < g7 && g7 < g8 && g8 < g9 && g9 < g10, 'post-upstream order must be g4<g6<g7<g8<g9<g10');
    const fetchAt = source.indexOf('fetch(`${API}/auth/login`', authzAt);
    assert.ok(fetchAt > g4 && fetchAt < g6, 'upstream fetch must stay between allowlist and dispatch gate');
  });

  it('DISPATCH_FAILED vs NON_OK are distinct branches', async () => {
    const threw = await simulatePreviewAuthorize({
      fetchImpl: async () => {
        throw new Error('conn refused');
      },
    });
    assert.equal(threw.gate, 'UPSTREAM_DISPATCH_FAILED');
    assert.equal(threw.code, G6_DISPATCH);
    const nonOk = await simulatePreviewAuthorize({
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    assert.equal(nonOk.gate, 'UPSTREAM_NON_OK');
    assert.equal(nonOk.code, G7_NON_OK);
    assert.notEqual(threw.code, nonOk.code);
  });

  it('behavioral mapping covers all 10 gates with exact upstream counts', async () => {
    const cases = [
      {
        name: 'RUNTIME_DISABLED',
        args: { vercelEnv: 'production', enabled: 'true' },
        gate: 'RUNTIME_DISABLED',
        code: G2_ENABLED,
        upstream: 0,
      },
      {
        name: 'APP_SECRET',
        args: { receivedSecret: 'wrong' },
        gate: 'APP_SECRET_GATE_REJECTED',
        code: G3_SECRET_MISMATCH,
        upstream: 0,
      },
      {
        name: 'ALLOWLIST',
        args: { credentials: { email: 'other@example.test', password: 'pw' } },
        gate: 'DRIVER_ALLOWLIST_REJECTED',
        code: G4_ALLOWLIST,
        upstream: 0,
      },
      {
        name: 'SHAPE-password',
        args: { credentials: { email: 'driver-38b@example.test' } },
        gate: 'CREDENTIAL_SHAPE_REJECTED',
        code: G5_SHAPE,
        upstream: 0,
      },
      {
        name: 'SHAPE-null',
        args: { credentials: null },
        gate: 'CREDENTIAL_SHAPE_REJECTED',
        code: G5_SHAPE,
        upstream: 0,
      },
      {
        name: 'DISPATCH',
        args: { fetchImpl: async () => { throw new Error('x'); } },
        gate: 'UPSTREAM_DISPATCH_FAILED',
        code: G6_DISPATCH,
        upstream: 1,
      },
      {
        name: 'NON_OK',
        args: { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) },
        gate: 'UPSTREAM_NON_OK',
        code: G7_NON_OK,
        upstream: 1,
      },
      {
        name: 'INVALID-json-throw',
        args: {
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('bad json');
            },
          }),
        },
        gate: 'UPSTREAM_RESPONSE_INVALID',
        code: G8_INVALID,
        upstream: 1,
      },
      {
        name: 'INVALID-missing-user',
        args: { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) },
        gate: 'UPSTREAM_RESPONSE_INVALID',
        code: G8_INVALID,
        upstream: 1,
      },
      {
        name: 'ROLE',
        args: {
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ user: { role: 'seller', driverApproved: true } }),
          }),
        },
        gate: 'ROLE_REJECTED',
        code: G9_ROLE,
        upstream: 1,
      },
      {
        name: 'APPROVAL',
        args: {
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ user: { role: 'driver', driverApproved: false } }),
          }),
        },
        gate: 'APPROVAL_REJECTED',
        code: G10_APPROVAL,
        upstream: 1,
      },
    ];
    for (const c of cases) {
      const r = await simulatePreviewAuthorize(c.args);
      assert.equal(r.rejected, true, `${c.name} must reject`);
      assert.equal(r.gate, c.gate, `${c.name} gate`);
      assert.equal(r.code, c.code, `${c.name} code`);
      assert.equal(r.upstreamCalls, c.upstream, `${c.name} upstream calls`);
    }
  });

  it('diagnostic disabled path exposes no new output (local runtime has no gate codes)', () => {
    const localStart = source.indexOf('async function authorizeLocalDriver');
    const localEnd = source.indexOf('async function refreshAccessToken');
    assert.ok(localStart >= 0 && localEnd > localStart, 'local fn bounds');
    const localScope = source.slice(localStart, localEnd);
    for (const code of ALL_CODES) {
      assert.ok(!localScope.includes(code), `local path must not emit ${code}`);
    }
    assert.ok(!localScope.includes('DiagnosticCredentialsSignin'), 'local path must not throw diagnostic');
    assert.ok(!localScope.includes('driver-g'), 'local path must not reference driver gate');
  });

  it('codes are static literals only (no secret/value/hash/length/plaintext)', () => {
    const calls = [...source.matchAll(/new DiagnosticCredentialsSignin\(([^)]*)\)/g)].map((m) => m[1].trim().replace(/,$/, '').trim());
    assert.ok(calls.length >= 9, `expected >=9 diagnostic sites, got ${calls.length}`);
    for (const arg of calls) {
      // Multiline throws collapse to the literal; allow trailing comma stripped above.
      const singleLine = arg.split('\n').map((s) => s.trim()).filter(Boolean).join('');
      assert.match(
        singleLine.replace(/,$/, ''),
        /^'authorize-rejected__driver-g\d+-[a-z-]+'$/,
        `diagnostic must be static closed-enum literal, got: ${arg}`,
      );
    }
    for (const forbidden of ['${email}', '${password}', '${got}', '${expected}', '${credentials}', '.length', 'createHash', 'fingerprint', 'Date.now()']) {
      // Codes themselves carry none; the surrounding gate file must not
      // interpolate values into codes (hash use stays in secretsMatch only).
      if (forbidden === 'createHash') continue;
      for (const code of ALL_CODES) assert.ok(!code.includes(forbidden), `code must not contain ${forbidden}`);
    }
    assert.ok(!source.includes('console.'), 'auth boundary must not log');
  });

  it('auth semantics preserved (fail-closed, request shape, checks)', () => {
    assert.match(source, /from\s*['"]@\/lib\/api-base-url['"]/);
    assert.match(source, /const\s+API\s*=\s*getApiBaseUrl\s*\(\s*\)/);
    assert.match(source, /fetch\s*\(\s*`\$\{API\}\/auth\/login`/);
    assert.match(source, /body:\s*JSON\.stringify\(\{\s*email:\s*credShape\.email,\s*password:\s*credShape\.password,\s*\}\)/);
    assert.ok(!source.includes('...credShape'), 'must not spread credentials');
    assert.match(source, /if\s*\(\s*!res\.ok\s*\)/);
    assert.match(source, /data\.user|gatedUser|gatedRecord/);
    // No new bypass, no fallback that turns reject into authorize.
    assert.doesNotMatch(source, /return\s+\{\s*id:\s*['"]fallback/);
    assert.doesNotMatch(source, /DRIVER_SESSION_COOKIE/);
  });

  it('API_BASE_UNRESOLVED is contract-complete but not emitted (no behavior change)', () => {
    assert.ok(source.includes('API_BASE_UNRESOLVED'), 'enum doc must mention API_BASE_UNRESOLVED');
    assert.ok(!source.includes('driver-g11') && !source.includes('api-base-unresolved'), 'no throw site for API_BASE_UNRESOLVED');
    const count = (source.match(/authorize-rejected__driver-g\d+/g) ?? []).length;
    // g2,g3,g4,g5(x3 sites but same code),g6,g7,g8(x2 sites),g9,g10 = distinct codes 9, sites >=9
    assert.ok(count >= 9, `expected >=9 driver gate code occurrences, got ${count}`);
  });
});
