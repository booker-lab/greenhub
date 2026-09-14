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

// Mirror of apps/consumer/src/auth.ts authorize ordering (E2E gate, then
// admission gate, then exactly one upstream POST with {email,password}).
// Proves upstream-call counts for each admission class without importing
// NextAuth or touching the network.
async function simulateAuthorize({ credentials, e2eOk = true, fetchImpl }) {
  let upstreamCalls = 0;
  let lastBody = null;
  const fetch =
    fetchImpl ??
    (async (_url, init = {}) => {
      upstreamCalls += 1;
      lastBody = init.body;
      return { ok: true, status: 200, json: async () => ({}) };
    });
  if (!e2eOk) {
    return { rejected: true, code: 'authorize-rejected', upstreamCalls: 0, lastBody: null };
  }
  if (!isAdmittedLoginCredentials(credentials)) {
    return { rejected: true, code: 'authorize-rejected', upstreamCalls: 0, lastBody: null };
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
    assert.equal(result.code, 'authorize-rejected');
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
    assert.equal(result.code, 'authorize-rejected');
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
      /^'authorize-rejected'$|^'upstream-rejected'$|^'api-binding-failure'$|^buildUpstreamRejectedCode\(/,
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
  assert.equal(rejected.code, 'authorize-rejected');
  assert.equal(rejected.lastBody, null);
});
