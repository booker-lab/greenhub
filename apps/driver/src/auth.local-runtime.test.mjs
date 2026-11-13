import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const authSource = fs.readFileSync(path.join(directory, 'auth.ts'), 'utf8');
const loginSource = fs.readFileSync(
  path.join(directory, 'app', 'login', 'page.tsx'),
  'utf8',
);

// Small source-scope helper: extract a `{ ... }` body block starting from an anchor.
// Skips the parameter list first so destructured params (`{ user, account }`)
// are not mistaken for the function body. Brace counting stays naive otherwise
// (template `${API}` pairs stay balanced) and keeps the test free of line pins.
function extractBlock(source, anchorPattern, label) {
  const start = source.search(anchorPattern);
  assert.ok(start !== -1, `${label} anchor not found: ${anchorPattern}`);
  let bodySearchFrom = start;
  const parenOpen = source.indexOf('(', start);
  if (parenOpen !== -1) {
    let parenDepth = 0;
    for (let i = parenOpen; i < source.length; i += 1) {
      if (source[i] === '(') parenDepth += 1;
      if (source[i] === ')') parenDepth -= 1;
      if (parenDepth === 0) {
        bodySearchFrom = i;
        break;
      }
    }
  }
  const open = source.indexOf('{', bodySearchFrom);
  assert.ok(open !== -1, `${label} opening brace not found`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${label} block never closed`);
}

function extractStatement(source, anchorPattern, label) {
  const start = source.search(anchorPattern);
  assert.ok(start !== -1, `${label} anchor not found: ${anchorPattern}`);
  const end = source.indexOf(';', start);
  assert.ok(end !== -1, `${label} statement never terminated`);
  return source.slice(start, end + 1);
}

describe('드라이버 local-runtime 인증 source-read 회귀 계약', () => {
  it('local runtime은 GREENHUB_LOCAL_RUNTIME === "true" 명시 marker만 허용한다', () => {
    const localScope = extractBlock(
      authSource,
      /function\s+isLocalCredentialRuntime\s*\(/,
      'isLocalCredentialRuntime',
    );
    // Strict string comparison pins the contract; mere token presence is not enough.
    assert.match(localScope, /GREENHUB_LOCAL_RUNTIME\s*!==\s*['"]true['"]/);
  });

  it('local marker 완화를 허용하지 않는다 (truthy 단독 검사 금지)', () => {
    const localScope = extractBlock(
      authSource,
      /function\s+isLocalCredentialRuntime\s*\(/,
      'isLocalCredentialRuntime',
    );
    // `if (process.env.GREENHUB_LOCAL_RUNTIME)` 같은 truthy 완화가 들어오면 실패한다.
    // 현재 구현(`!== 'true'`)은 이 패턴과 매치되지 않아야 한다.
    assert.doesNotMatch(localScope, /process\.env\.GREENHUB_LOCAL_RUNTIME\s*\)/);
  });

  it('production 표시마다 local runtime을 fail-close한다 (NODE_ENV)', () => {
    const localScope = extractBlock(
      authSource,
      /function\s+isLocalCredentialRuntime\s*\(/,
      'isLocalCredentialRuntime',
    );
    assert.match(
      localScope,
      /NODE_ENV\s*===\s*['"]production['"][\s\S]{0,120}return false/,
    );
  });

  it('production 표시마다 local runtime을 fail-close한다 (VERCEL_ENV)', () => {
    const localScope = extractBlock(
      authSource,
      /function\s+isLocalCredentialRuntime\s*\(/,
      'isLocalCredentialRuntime',
    );
    assert.match(
      localScope,
      /VERCEL_ENV\s*===\s*['"]production['"][\s\S]{0,120}return false/,
    );
  });

  it('production 표시마다 local runtime을 fail-close한다 (RAILWAY_ENVIRONMENT_NAME)', () => {
    const localScope = extractBlock(
      authSource,
      /function\s+isLocalCredentialRuntime\s*\(/,
      'isLocalCredentialRuntime',
    );
    assert.match(
      localScope,
      /RAILWAY_ENVIRONMENT_NAME\s*===\s*['"]production['"][\s\S]{0,120}return false/,
    );
  });

  it('local 분기가 preview-E2E gate보다 먼저 독립적으로 분기한다', () => {
    const authorizeScope = extractBlock(
      authSource,
      /async\s+authorize\s*\(\s*credentials/,
      'Credentials authorize',
    );
    const localAt = authorizeScope.search(/isLocalCredentialRuntime\s*\(\s*\)/);
    assert.ok(localAt !== -1, 'local runtime branch missing in authorize');
    assert.match(authorizeScope, /return\s+authorizeLocalDriver\s*\(/);
    const previewAt = authorizeScope.search(/VERCEL_ENV\s*!==\s*['"]preview['"]/);
    assert.ok(previewAt !== -1, 'preview gate missing in authorize');
    assert.ok(
      localAt < previewAt,
      'local branch must precede the preview-E2E gate',
    );
  });

  it('local 경로는 preview 전용 계약에 의존하지 않는다', () => {
    const localFn = extractBlock(
      authSource,
      /function\s+authorizeLocalDriver\s*\(/,
      'authorizeLocalDriver',
    );
    assert.doesNotMatch(localFn, /VERCEL_ENV/);
    assert.doesNotMatch(localFn, /ROUND_DIRECT_E2E_ENABLED/);
    assert.doesNotMatch(localFn, /ROUND_DIRECT_E2E_SHARED_SECRET/);
    assert.doesNotMatch(localFn, /x-round-direct-e2e-secret/);
    assert.doesNotMatch(localFn, /ROUND_DIRECT_E2E_DRIVER_EMAILS/);
    assert.doesNotMatch(localFn, /isAllowedE2EDriverEmail/);
  });

  it('local authorize는 API 실패를 세션 없이 닫는다 (승인 대기 code만 따로, 함수 scope 분리)', () => {
    const localFn = extractBlock(
      authSource,
      /function\s+authorizeLocalDriver\s*\(/,
      'authorizeLocalDriver',
    );
    const notOk = extractBlock(localFn, /if\s*\(\s*!res\.ok\s*\)/, 'local !res.ok branch');
    // 403 + API 승인 대기 code만 승인 대기 오류로, 그 밖의 거절은 null(일반 실패)로 닫는다.
    assert.match(
      notOk,
      /res\.status\s*===\s*403\s*&&\s*\(await readRejectionCode\(res\)\)\s*===\s*DRIVER_APPROVAL_PENDING/,
    );
    assert.match(notOk, /throw new LocalDriverApprovalPendingSignin\(\)/);
    assert.match(notOk, /return null;\s*\}$/);
    // 승인 대기 오류는 CredentialsSignin을 상속하고 고정 code만 싣는다(로그인 화면 판정과 같은 상수).
    const errorClass = extractBlock(
      authSource,
      /class\s+LocalDriverApprovalPendingSignin\s+extends\s+CredentialsSignin/,
      'LocalDriverApprovalPendingSignin',
    );
    assert.match(errorClass, /this\.code\s*=\s*LOCAL_DRIVER_APPROVAL_PENDING_CODE;/);
    assert.match(
      authSource,
      /import \{ LOCAL_DRIVER_APPROVAL_PENDING_CODE \} from '@\/app\/login\/local-credential-sign-in';/,
    );
  });

  it('local authorize는 role === driver만 허용한다 (함수 scope 분리)', () => {
    const localFn = extractBlock(
      authSource,
      /function\s+authorizeLocalDriver\s*\(/,
      'authorizeLocalDriver',
    );
    assert.match(localFn, /data\.user\.role\s*!==\s*['"]driver['"]/);
    assert.match(localFn, /return null/);
  });

  it('local authorize는 driverApproved === true만 허용한다 (함수 scope 분리)', () => {
    const localFn = extractBlock(
      authSource,
      /function\s+authorizeLocalDriver\s*\(/,
      'authorizeLocalDriver',
    );
    // 응답의 승인 상태 재확인도 세션 없이 승인 대기 안내로 보낸다.
    assert.match(
      localFn,
      /if\s*\(\s*data\.user\.driverApproved\s*!==\s*true\s*\)\s*throw new LocalDriverApprovalPendingSignin\(\)/,
    );
    assert.ok(
      localFn.indexOf('driverApproved !== true') < localFn.indexOf('accessToken: data.accessToken'),
      '승인 확인 뒤에만 토큰을 싣는다',
    );
  });

  it('local 로그인은 canonical API base resolver를 경유해 /auth/login에 연결한다', () => {
    // Resolver 자체의 전체 계약은 api-base-url/launcher test가 소유한다.
    // 여기서는 Driver local auth가 canonical resolver를 소비한다는 경계만 고정한다.
    assert.match(authSource, /from\s*['"]@\/lib\/api-base-url['"]/);
    assert.match(authSource, /getApiBaseUrl|resolveApiBaseUrl/);
    assert.match(authSource, /const\s+API\s*=\s*getApiBaseUrl\s*\(\s*\)/);
    const localFn = extractBlock(
      authSource,
      /function\s+authorizeLocalDriver\s*\(/,
      'authorizeLocalDriver',
    );
    assert.match(localFn, /fetch\s*\(\s*`\$\{API\}\/auth\/login`/);
  });

  it('local 경로에 하드코딩된 production URL·외부 provider 우회가 없다', () => {
    const localFn = extractBlock(
      authSource,
      /function\s+authorizeLocalDriver\s*\(/,
      'authorizeLocalDriver',
    );
    assert.doesNotMatch(localFn, /https?:\/\//);
    assert.doesNotMatch(localFn, /kakao-login/);
  });

  it('login 페이지는 local Credentials UI를 명시 marker + non-production 결합으로만 노출한다', () => {
    const gate = extractStatement(
      loginSource,
      /showLocalCredentials\s*=/,
      'showLocalCredentials',
    );
    assert.match(gate, /GREENHUB_LOCAL_RUNTIME\s*===\s*['"]true['"]/);
    assert.match(gate, /NODE_ENV\s*!==\s*['"]production['"]/);
    assert.match(
      gate,
      /GREENHUB_LOCAL_RUNTIME[\s\S]{0,200}&&[\s\S]{0,200}NODE_ENV/,
    );
    assert.match(loginSource, /showLocalCredentials\s*&&/);
  });

  // 로그인 뒤 돌아갈 곳은 폼의 callbackUrl을 다시 검증한 값이고, 허용하지 않으면 /board다
  // (resolveDriverReturnPath 동작은 lib/login-redirect.test.mjs가 확인한다).
  it('login 로컬 액션은 credentials → 검증된 복귀 경로(기본 /board) 계약을 유지한다', () => {
    const action = extractBlock(
      loginSource,
      /function\s+localCredentialSignIn\s*\(/,
      'localCredentialSignIn',
    );
    assert.match(
      action,
      /const returnPath = resolveDriverReturnPath\(formData\.get\(['"]callbackUrl['"]\)\);/,
    );
    assert.match(action, /signIn\s*\(\s*['"]credentials['"]/);
    assert.match(action, /redirectTo:\s*returnPath,/);
    // 성공하면 검증된 경로를 돌려주고, 폼이 전체 페이지로 이동한다.
    assert.match(action, /return \{ redirectTo: returnPath \};\s*\}$/);
  });

  // 틀린 비밀번호·승인 전 계정이 Next 기본 오류 화면으로 떨어지지 않는다.
  it('login 로컬 액션은 Auth.js 실패만 로그인 안내로 바꾸고 그 밖의 오류는 다시 던진다', () => {
    const action = extractBlock(
      loginSource,
      /function\s+localCredentialSignIn\s*\(/,
      'localCredentialSignIn',
    );
    // 서버 액션 안에서 Auth.js가 redirect하지 않게 한다(클라이언트 이동이면 세션을 다시 읽지 않는다).
    assert.match(action, /redirect:\s*false/);
    const handler = extractBlock(action, /catch\s*\(\s*error\s*\)/, 'local action catch');
    assert.match(handler, /if \(error instanceof AuthError\) \{/);
    assert.match(
      handler,
      /localCredentialFailurePath\(\{\s*code: error instanceof CredentialsSignin \? error\.code : undefined,\s*returnPath,\s*\}\)/,
    );
    // AuthError가 아닌 오류(Next redirect·notFound 신호 포함)는 삼키지 않는다.
    assert.match(handler, /\}\s*throw error;\s*\}$/);
    assert.match(loginSource, /import \{ AuthError, CredentialsSignin \} from 'next-auth';/);
  });

  it('login 로컬 폼만 전체 페이지 이동 폼을 쓰고 카카오 폼은 서버 액션을 그대로 쓴다', () => {
    assert.match(loginSource, /<LocalCredentialForm signInAction=\{localCredentialSignIn\}>/);
    assert.doesNotMatch(loginSource, /action=\{localCredentialSignIn\}/);
    assert.match(loginSource, /<form action=\{kakaoSignIn\}>/);
    const formSource = fs.readFileSync(
      path.join(directory, 'app', 'login', 'local-credential-form.tsx'),
      'utf8',
    );
    assert.match(formSource, /^'use client';/);
    assert.match(
      formSource,
      /const \{ redirectTo \} = await signInAction\(formData\);\s*window\.location\.replace\(redirectTo\);/,
    );
    // 로그인 화면 기록을 남기면 복귀한 화면에서 뒤로가기가 /login → (로그인 상태라) 같은 화면으로 맴돈다(findings §5.4).
    assert.doesNotMatch(formSource, /window\.location\.assign/);
  });

  it('Kakao Driver auth가 local 지원과 공존한다 (provider 등록 유지)', () => {
    assert.match(authSource, /next-auth\/providers\/kakao/);
    assert.match(authSource, /Kakao\s*\(\s*\{/);
    assert.match(authSource, /KAKAO_CLIENT_ID/);
    assert.match(authSource, /KAKAO_CLIENT_SECRET/);
    assert.match(loginSource, /카카오로 시작하기/);
    assert.match(loginSource, /signIn\s*\(\s*['"]kakao['"]/);
  });

  it('Driver targetRole + kakao-only signIn 의미를 유지한다', () => {
    assert.match(authSource, /targetRole\s*:\s*['"]driver['"]/);
    assert.match(authSource, /\/auth\/kakao-login/);
    const signInScope = extractBlock(
      authSource,
      /async\s+signIn\s*\(\s*\{\s*user/,
      'signIn callback',
    );
    assert.match(signInScope, /account\?\.provider\s*===\s*['"]credentials['"]/);
    assert.match(signInScope, /account\?\.provider\s*!==\s*['"]kakao['"]/);
    assert.match(signInScope, /targetRole\s*:\s*['"]driver['"]/);
  });

  it('preview-E2E admission path가 local test와 독립적으로 보존된다', () => {
    const authorizeScope = extractBlock(
      authSource,
      /async\s+authorize\s*\(\s*credentials/,
      'Credentials authorize',
    );
    assert.match(authorizeScope, /VERCEL_ENV\s*!==\s*['"]preview['"]/);
    assert.match(authorizeScope, /ROUND_DIRECT_E2E_ENABLED\s*!==\s*['"]true['"]/);
    assert.match(authorizeScope, /ROUND_DIRECT_E2E_SHARED_SECRET/);
    assert.match(authorizeScope, /x-round-direct-e2e-secret/);
    assert.match(authorizeScope, /ROUND_DIRECT_E2E_DRIVER_EMAILS|isAllowedE2EDriverEmail/);
  });
});
