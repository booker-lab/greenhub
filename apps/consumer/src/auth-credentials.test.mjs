import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const here = new URL('./', import.meta.url);
const realRequire = createRequire(new URL('./auth-credentials.test.mjs', import.meta.url));

const source = await readFile(new URL('./auth-credentials.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'auth-credentials.ts',
}).outputText;

const validationModule = { exports: {} };
const requireForTest = (specifier) => {
  if (specifier === 'validator/lib/isEmail') return realRequire('validator/lib/isEmail');
  throw new Error(`unexpected module request in test: ${specifier}`);
};

new Function('require', 'module', 'exports', compiled)(
  requireForTest,
  validationModule,
  validationModule.exports,
);

const { isAdmittedLoginCredentials, isAdmittedLoginEmail, isAdmittedLoginPassword } =
  validationModule.exports;

const VALID_EMAIL = 'consumer-proof-34a@example.test';
const VALID_PASSWORD = 'valid-password-fixture-34a';
const MALFORMED_EMAILS = Object.freeze([
  'not-an-email',
  'plainaddress',
  'a@b',
  'user@example',
  '@missing-local.com',
  'user@.com',
  'a@b@c.com',
  'user@exam_ple.com',
]);

// Mirror of apps/consumer/src/auth.ts authorize ordering (38C pre-upstream
// diagnostic projection: S1 secret-missing → g1, S2 secret-mismatch → g2,
// S3 admission gate → g3, then exactly one upstream POST with
// {email,password}).
// Proves upstream-call counts for each admission class without importing
// NextAuth or touching the network.
const G1_SECRET_MISSING = 'authorize-rejected__g1-secret-missing';
const G2_SECRET_MISMATCH = 'authorize-rejected__g2-secret-mismatch';
const G3_ADMISSION_REJECTED = 'authorize-rejected__g3-credential-admission-rejected';
const DEFAULT_E2E_SECRET_FIXTURE = 'e2e-secret-fixture-38c';
async function simulateAuthorize({ credentials, fetchImpl, ...gate }) {
  // Explicit `undefined`/`null` must stay observable (S1/S2 proof); only an
  // omitted key falls back to the matching fixture.
  const expectedSecret =
    'expectedSecret' in gate ? gate.expectedSecret : DEFAULT_E2E_SECRET_FIXTURE;
  const gotToken = 'gotToken' in gate ? gate.gotToken : DEFAULT_E2E_SECRET_FIXTURE;
  let upstreamCalls = 0;
  let lastBody = null;
  const fetch =
    fetchImpl ??
    (async (_url, init = {}) => {
      upstreamCalls += 1;
      lastBody = init.body;
      return { ok: true, status: 200, json: async () => ({}) };
    });
  if (!expectedSecret) {
    return { rejected: true, code: G1_SECRET_MISSING, upstreamCalls: 0, lastBody: null };
  }
  if (gotToken !== expectedSecret) {
    return { rejected: true, code: G2_SECRET_MISMATCH, upstreamCalls: 0, lastBody: null };
  }
  if (!isAdmittedLoginCredentials(credentials)) {
    return { rejected: true, code: G3_ADMISSION_REJECTED, upstreamCalls: 0, lastBody: null };
  }
  const { email, password } = credentials;
  await fetch('https://api.example.test/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { rejected: false, code: null, upstreamCalls, lastBody };
}

test('1: valid email + valid password is admitted with one upstream call', async () => {
  assert.equal(isAdmittedLoginEmail(VALID_EMAIL), true);
  assert.equal(isAdmittedLoginPassword(VALID_PASSWORD), true);
  assert.equal(
    isAdmittedLoginCredentials({ email: VALID_EMAIL, password: VALID_PASSWORD }),
    true,
  );
  const result = await simulateAuthorize({
    credentials: { email: VALID_EMAIL, password: VALID_PASSWORD },
  });
  assert.equal(result.rejected, false);
  assert.equal(result.upstreamCalls, 1);
});

test('2: malformed non-empty email is fail-closed with zero upstream calls', async () => {
  for (const email of [...MALFORMED_EMAILS, '', '   ']) {
    assert.equal(isAdmittedLoginEmail(email), false, `email must be rejected: ${email}`);
    const result = await simulateAuthorize({
      credentials: { email, password: VALID_PASSWORD },
    });
    assert.equal(result.rejected, true);
    assert.equal(result.code, G3_ADMISSION_REJECTED);
    assert.equal(result.upstreamCalls, 0, `upstream must be 0 for: ${email}`);
  }
});

test('3: missing email is fail-closed with zero upstream calls', async () => {
  for (const credentials of [
    { password: VALID_PASSWORD },
    { email: undefined, password: VALID_PASSWORD },
    { email: '', password: VALID_PASSWORD },
    undefined,
    null,
  ]) {
    assert.equal(isAdmittedLoginCredentials(credentials), false);
    const result = await simulateAuthorize({ credentials });
    assert.equal(result.rejected, true);
    assert.equal(result.upstreamCalls, 0);
  }
});

test('4: non-string email is fail-closed with zero upstream calls', async () => {
  for (const email of [123, 0, true, null, {}, [], ['a@b.com']]) {
    assert.equal(isAdmittedLoginEmail(email), false);
    const result = await simulateAuthorize({
      credentials: { email, password: VALID_PASSWORD },
    });
    assert.equal(result.rejected, true);
    assert.equal(result.upstreamCalls, 0);
  }
});

test('5: missing/non-string password is fail-closed with zero upstream calls', async () => {
  for (const password of [undefined, null, '', 123, true, {}, []]) {
    assert.equal(isAdmittedLoginPassword(password), false, `password must be rejected`);
    const result = await simulateAuthorize({
      credentials: { email: VALID_EMAIL, password },
    });
    assert.equal(result.rejected, true);
    assert.equal(result.code, G3_ADMISSION_REJECTED);
    assert.equal(result.upstreamCalls, 0);
  }
  // No regression: any non-empty string password (API @IsString admits it)
  // stays admitted, including whitespace-only.
  assert.equal(isAdmittedLoginPassword('   '), true);
  const whitespace = await simulateAuthorize({
    credentials: { email: VALID_EMAIL, password: '   ' },
  });
  assert.equal(whitespace.upstreamCalls, 1);
});

test('6: forwarded body is exactly {email,password} with no extra keys', async () => {
  const result = await simulateAuthorize({
    credentials: { email: VALID_EMAIL, password: VALID_PASSWORD },
  });
  assert.ok(result.lastBody);
  const parsed = JSON.parse(result.lastBody);
  assert.deepEqual(Object.keys(parsed).sort(), ['email', 'password']);
  assert.equal(parsed.email, VALID_EMAIL);
  assert.equal(parsed.password, VALID_PASSWORD);

  const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');
  assert.match(
    authSource,
    /body:\s*JSON\.stringify\(\{\s*email,\s*password,\s*\}\)/,
    'auth.ts must forward exactly {email,password} with no extra keys or normalization',
  );
  assert.ok(
    !authSource.includes('...credentials'),
    'auth.ts must not spread credentials into the upstream body',
  );
});

test('7: probe/form construction keeps the email/password string contract', async () => {
  const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');
  assert.match(authSource, /email:\s*\{\s*label:.*type:\s*'email'/);
  assert.match(authSource, /password:\s*\{\s*label:.*type:\s*'password'/);

  const probeSource = await readFile(
    new URL('../../../scripts/probe-consumer-callback.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(probeSource.includes("form.set('email'"), 'probe must set the email field');
  assert.ok(probeSource.includes("form.set('password'"), 'probe must set the password field');
  assert.ok(
    probeSource.includes('application/x-www-form-urlencoded'),
    'probe callback POST must stay urlencoded',
  );

  const formSource = await readFile(new URL('./app/login/_form.tsx', import.meta.url), 'utf8');
  assert.ok(formSource.includes("signIn('credentials'"), 'login form must use credentials');
  assert.match(formSource, /email,\s*password/, 'login form must pass email/password strings');
});

test('8: credential values and secrets never enter errors or logs', async () => {
  for (const unit of [source, await readFile(new URL('./auth.ts', import.meta.url), 'utf8')]) {
    assert.ok(!unit.includes('console.'), 'auth boundary must not log');
  }
  const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');
  const signinCalls = [...authSource.matchAll(/new DiagnosticCredentialsSignin\(([^)]*)\)/g)].map(
    (match) => match[1].trim(),
  );
  assert.ok(signinCalls.length > 0, 'expected DiagnosticCredentialsSignin throw sites');
  for (const arg of signinCalls) {
    assert.match(
      arg,
      /^'authorize-rejected__g1-secret-missing',?$|^'authorize-rejected__g2-secret-mismatch',?$|^'authorize-rejected__g3-credential-admission-rejected',?$|^'upstream-rejected',?$|^'api-binding-failure',?$|^buildUpstreamRejectedCode\(/,
      `rejection must carry a static code only, got: ${arg}`,
    );
  }
  for (const forbidden of ['${email}', '${password}', '${got}', '${expected}', '${credentials']) {
    assert.ok(!authSource.includes(forbidden), `auth.ts must not interpolate ${forbidden}`);
    assert.ok(!source.includes(forbidden), `helper must not interpolate ${forbidden}`);
  }

  // Rejected values themselves never surface through the helper or harness.
  const rejected = await simulateAuthorize({
    credentials: { email: 'not-an-email', password: VALID_PASSWORD },
  });
  assert.equal(rejected.code, G3_ADMISSION_REJECTED);
  assert.equal(rejected.lastBody, null);
});

test('9 (38C): secret missing emits g1 with zero upstream calls', async () => {
  for (const expectedSecret of ['', undefined, null]) {
    const result = await simulateAuthorize({
      credentials: { email: VALID_EMAIL, password: VALID_PASSWORD },
      expectedSecret,
      gotToken: 'anything',
    });
    assert.equal(result.rejected, true);
    assert.equal(result.code, G1_SECRET_MISSING);
    assert.equal(result.upstreamCalls, 0);
    assert.equal(result.lastBody, null);
  }
  const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');
  assert.ok(
    authSource.includes(`'${G1_SECRET_MISSING}'`),
    'auth.ts must emit the g1 static code',
  );
});

test('10 (38C): secret mismatch emits g2 with zero upstream calls', async () => {
  const expectedSecret = 'e2e-secret-fixture-38c';
  for (const gotToken of ['wrong-token', '', undefined, null]) {
    const result = await simulateAuthorize({
      credentials: { email: VALID_EMAIL, password: VALID_PASSWORD },
      expectedSecret,
      gotToken,
    });
    assert.equal(result.rejected, true);
    assert.equal(result.code, G2_SECRET_MISMATCH);
    assert.equal(result.upstreamCalls, 0);
    assert.equal(result.lastBody, null);
  }
  const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');
  assert.ok(
    authSource.includes(`'${G2_SECRET_MISMATCH}'`),
    'auth.ts must emit the g2 static code',
  );
});

test('11 (38C): gate ordering is S1, then S2, then S3 with zero upstream', async () => {
  // S1 wins over S2/S3 even with mismatched token + malformed credentials.
  const s1 = await simulateAuthorize({
    credentials: { email: 'not-an-email', password: '' },
    expectedSecret: '',
    gotToken: 'wrong',
  });
  assert.equal(s1.code, G1_SECRET_MISSING);
  assert.equal(s1.upstreamCalls, 0);
  // S2 wins over S3 even with malformed credentials.
  const s2 = await simulateAuthorize({
    credentials: { email: 'not-an-email', password: '' },
    expectedSecret: 'e2e-secret-fixture-38c',
    gotToken: 'wrong-token',
  });
  assert.equal(s2.code, G2_SECRET_MISMATCH);
  assert.equal(s2.upstreamCalls, 0);
  // S3 fires only after S1/S2 pass.
  const s3 = await simulateAuthorize({
    credentials: { email: 'not-an-email', password: VALID_PASSWORD },
    expectedSecret: 'e2e-secret-fixture-38c',
    gotToken: 'e2e-secret-fixture-38c',
  });
  assert.equal(s3.code, G3_ADMISSION_REJECTED);
  assert.equal(s3.upstreamCalls, 0);
  // Admitted credentials proceed to the existing upstream path.
  let upstreamCalls = 0;
  const ok = await simulateAuthorize({
    credentials: { email: VALID_EMAIL, password: VALID_PASSWORD },
    expectedSecret: 'e2e-secret-fixture-38c',
    gotToken: 'e2e-secret-fixture-38c',
    fetchImpl: async () => {
      upstreamCalls += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(ok.rejected, false);
  assert.equal(upstreamCalls, 1);

  const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');
  const g1At = authSource.indexOf(`'${G1_SECRET_MISSING}'`);
  const g2At = authSource.indexOf(`'${G2_SECRET_MISMATCH}'`);
  const g3At = authSource.indexOf(`'${G3_ADMISSION_REJECTED}'`);
  const fetchAt = authSource.indexOf('fetch(`${API}/auth/login`');
  assert.ok(g1At >= 0 && g2At > g1At && g3At > g2At, 'g1/g2/g3 must appear in S1,S2,S3 order');
  assert.ok(fetchAt > g3At, 'upstream fetch must stay after all three pre-upstream gates');
});

test('12 (38C): pre-upstream codes stay in authorize-rejected family without sensitive data', async () => {
  for (const code of [G1_SECRET_MISSING, G2_SECRET_MISMATCH, G3_ADMISSION_REJECTED]) {
    assert.ok(code.startsWith('authorize-rejected'), `top-level class preserved: ${code}`);
  }
  assert.notEqual(G1_SECRET_MISSING, G2_SECRET_MISMATCH);
  assert.notEqual(G1_SECRET_MISSING, G3_ADMISSION_REJECTED);
  assert.notEqual(G2_SECRET_MISMATCH, G3_ADMISSION_REJECTED);
  const authSource = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');
  // Collapsed byte-identical gate is gone: no bare authorize-rejected throw remains.
  assert.equal(
    (authSource.match(/throw new DiagnosticCredentialsSignin\('authorize-rejected'\)/g) ?? [])
      .length,
    0,
    'pre-upstream gates must not collapse to bare authorize-rejected',
  );
  assert.equal(
    (authSource.match(/throw new DiagnosticCredentialsSignin\('authorize-rejected__g1-secret-missing'\)/g) ?? [])
      .length,
    1,
  );
  assert.equal(
    (authSource.match(/throw new DiagnosticCredentialsSignin\('authorize-rejected__g2-secret-mismatch'\)/g) ?? [])
      .length,
    1,
  );
  assert.equal(
    (authSource.match(/throw new DiagnosticCredentialsSignin\(\s*'authorize-rejected__g3-credential-admission-rejected'/g) ?? [])
      .length,
    1,
  );
  // Post-upstream + binding contracts unchanged.
  assert.equal(
    (authSource.match(/throw new DiagnosticCredentialsSignin\('api-binding-failure'\)/g) ?? [])
      .length,
    3,
    'api-binding-failure sites must stay 3',
  );
  assert.ok(
    authSource.includes('buildUpstreamRejectedCode('),
    'post-upstream diagnostic projection must stay',
  );
  // Static codes carry no values: lengths, hashes, fingerprints, timing,
  // headers, env contents, or credential/token material.
  for (const forbidden of [
    VALID_EMAIL,
    VALID_PASSWORD,
    'e2e-secret-fixture-38c',
    'wrong-token',
    'length',
    'fingerprint',
    'Date.now()',
    'x-e2e-test-token',
    'E2E_TEST_SECRET',
  ]) {
    for (const code of [G1_SECRET_MISSING, G2_SECRET_MISMATCH, G3_ADMISSION_REJECTED]) {
      assert.ok(!code.includes(forbidden), `diagnostic code must not contain ${forbidden}`);
    }
  }
  const gSection = authSource.slice(
    authSource.indexOf(G1_SECRET_MISSING) - 400,
    authSource.indexOf(G3_ADMISSION_REJECTED) + 400,
  );
  assert.ok(!gSection.includes('.length'), 'pre-upstream gates must not emit lengths');
  assert.ok(!gSection.includes('Date.now'), 'pre-upstream gates must not emit timing');
});
