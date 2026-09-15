import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(directory, 'auth.ts'), 'utf8');

describe('드라이버 Preview 전용 E2E 인증 보안 계약', () => {
  it('Credentials provider를 명시적으로 등록한다', () => {
    assert.match(source, /next-auth\/providers\/credentials/);
    assert.match(source, /Credentials\s*\(\s*\{/);
  });

  it('Preview와 명시적 enable 조건을 모두 검사한다', () => {
    assert.match(source, /VERCEL_ENV/);
    assert.match(source, /preview/);
    assert.match(source, /ROUND_DIRECT_E2E_ENABLED/);
    assert.match(source, /ROUND_DIRECT_E2E_ENABLED\s*!==\s*['"]true['"]/);
  });

  it('요청 공유 secret을 상수 시간 방식으로 비교한다', () => {
    assert.match(source, /ROUND_DIRECT_E2E_SHARED_SECRET/);
    assert.match(source, /x-round-direct-e2e-secret/);
    assert.match(source, /timingSafeEqual/);
  });

  it('허용된 전용 드라이버 이메일만 API 로그인으로 전달한다', () => {
    assert.match(source, /ROUND_DIRECT_E2E_DRIVER_EMAILS/);
    assert.match(source, /credentials\.email/);
    assert.match(source, /\/auth\/login/);
  });

  it('API 응답의 driver 역할과 승인 상태를 모두 확인한다', () => {
    assert.match(source, /data\.user\.role\s*!==\s*['"]driver['"]/);
    assert.match(source, /data\.user\.driverApproved\s*!==\s*true/);
  });

  it('Credentials 실패는 null로 닫고 장기 쿠키 경로를 만들지 않는다', () => {
    assert.match(source, /return null/);
    assert.doesNotMatch(source, /DRIVER_SESSION_COOKIE/);
  });
});

describe('드라이버 pre-upstream diagnostic projection (38D)', () => {
  const CODE_B = 'authorize-rejected__driver-g2-enabled';
  const CODE_C = 'authorize-rejected__driver-g3-secret-mismatch';
  const CODE_D = 'authorize-rejected__driver-g4-allowlist-rejected';

  it('B/C/D는 서로 다른 static rejection code로 projection된다', () => {
    assert.ok(source.includes(`'${CODE_B}'`), 'B code must be present as static literal');
    assert.ok(source.includes(`'${CODE_C}'`), 'C code must be present as static literal');
    assert.ok(source.includes(`'${CODE_D}'`), 'D code must be present as static literal');
    assert.notEqual(CODE_B, CODE_C);
    assert.notEqual(CODE_B, CODE_D);
    assert.notEqual(CODE_C, CODE_D);
  });

  it('B: enabled-gate 조건은 그대로 두고 rejection만 projection한다', () => {
    // 정책 불변: Preview-only + 명시적 enable 요구를 그대로 유지한다.
    assert.match(source, /VERCEL_ENV\s*!==\s*['"]preview['"]/);
    assert.match(source, /ROUND_DIRECT_E2E_ENABLED\s*!==\s*['"]true['"]/);
    // B 게이트가 고유 static code로 throw된다.
    assert.match(
      source,
      /VERCEL_ENV\s*!==\s*['"]preview['"][\s\S]{0,300}ROUND_DIRECT_E2E_ENABLED\s*!==\s*['"]true['"][\s\S]{0,300}authorize-rejected__driver-g2-enabled/,
    );
    assert.match(
      source,
      /new DiagnosticCredentialsSignin\(\s*['"]authorize-rejected__driver-g2-enabled['"]\s*\)/,
    );
  });

  it('C: shared-secret mismatch는 timing-safe 의미를 유지하고 고유 code로 projection한다', () => {
    // 정책 불변: timing-safe compare + header + env 요구를 유지한다.
    assert.match(source, /timingSafeEqual/);
    assert.match(source, /x-round-direct-e2e-secret/);
    assert.match(source, /ROUND_DIRECT_E2E_SHARED_SECRET/);
    assert.match(source, /secretsMatch\s*\(\s*receivedSecret\s*,\s*expectedSecret\s*\)/);
    assert.match(
      source,
      /new DiagnosticCredentialsSignin\(\s*['"]authorize-rejected__driver-g3-secret-mismatch['"]\s*\)/,
    );
  });

  it('D: allowlist rejection은 membership + password 조건을 유지하고 고유 code로 projection한다', () => {
    // 정책 불변: allowlist membership + password 존재 조건을 유지한다.
    assert.match(source, /ROUND_DIRECT_E2E_DRIVER_EMAILS/);
    assert.match(source, /isAllowedE2EDriverEmail\s*\(\s*credentials\.email\s*\)/);
    assert.match(source, /typeof credentials\.password\s*!==\s*['"]string['"]/);
    assert.match(
      source,
      /new DiagnosticCredentialsSignin\(\s*['"]authorize-rejected__driver-g4-allowlist-rejected['"]\s*\)/,
    );
  });

  it('E/F/G는 bare null 계약을 유지하고 diagnostic projection을 추가하지 않는다', () => {
    // E: upstream non-2xx는 여전히 bare null이다.
    assert.match(source, /if\s*\(\s*!res\.ok\s*\)\s*return null/);
    // F/G: role + approval은 여전히 bare null이다.
    assert.match(source, /data\.user\.role\s*!==\s*['"]driver['"]/);
    assert.match(source, /data\.user\.driverApproved\s*!==\s*true/);
    // Diagnostic throw는 B/C/D 세 곳에만 존재한다.
    const signinArgs = [...source.matchAll(/new DiagnosticCredentialsSignin\(([^)]*)\)/g)].map(
      (match) => match[1].trim(),
    );
    assert.equal(signinArgs.length, 3);
    assert.deepEqual(new Set(signinArgs).size, 3);
    for (const arg of signinArgs) {
      assert.match(
        arg,
        /^'authorize-rejected__driver-g2-enabled'$|^'authorize-rejected__driver-g3-secret-mismatch'$|^'authorize-rejected__driver-g4-allowlist-rejected'$/,
        `diagnostic must be one of the three static B/C/D codes, got: ${arg}`,
      );
    }
  });

  it('정상 Preview/E2E admitted path와 production/local 분기는 변하지 않는다', () => {
    // admitted path: 실제 /auth/login + driver role + approval + user projection 유지.
    assert.match(source, /\/auth\/login/);
    assert.match(source, /data\.user\.role\s*!==\s*['"]driver['"]/);
    assert.match(source, /data\.user\.driverApproved\s*!==\s*true/);
    // local-runtime 분기가 preview-E2E gate보다 먼저 그대로 분기한다.
    const localAt = source.search(/isLocalCredentialRuntime\s*\(\s*\)/);
    const previewAt = source.search(/VERCEL_ENV\s*!==\s*['"]preview['"]/);
    assert.ok(localAt !== -1 && previewAt !== -1);
    assert.ok(localAt < previewAt, 'local branch must still precede preview-E2E gate');
    assert.match(source, /return\s+authorizeLocalDriver\s*\(/);
  });

  it('diagnostic에 raw sensitive data가 포함되지 않는다', () => {
    assert.ok(!source.includes('console.'), 'auth boundary must not log');
    const signinArgs = [...source.matchAll(/new DiagnosticCredentialsSignin\(([^)]*)\)/g)].map(
      (match) => match[1].trim(),
    );
    // Stage labels (e.g. `secret-mismatch`, `allowlist-rejected`) are static
    // descriptors approved by the task example naming; they carry no value.
    // What must never appear is an actual value: email address, token bytes,
    // header/env content, or derived material (hash/fingerprint/length/timing).
    for (const arg of signinArgs) {
      assert.ok(!arg.includes('@'), `diagnostic must not carry email value, got: ${arg}`);
      assert.ok(!arg.includes('/'), `diagnostic must not carry path/origin value, got: ${arg}`);
      assert.ok(!arg.includes('='), `diagnostic must not carry env assignment, got: ${arg}`);
    }
    for (const forbidden of ['${email}', '${password}', '${got}', '${expected}', '${credentials']) {
      assert.ok(!source.includes(forbidden), `auth.ts must not interpolate ${forbidden}`);
    }
    // 코드 리터럴 외에 동적 fingerprint/length/timing 유출이 없다.
    assert.doesNotMatch(source, /DiagnosticCredentialsSignin\(\s*`/);
    assert.doesNotMatch(source, /DiagnosticCredentialsSignin\(\s*["'][^"']*\$\{/);
  });
});
