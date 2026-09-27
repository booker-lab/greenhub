/**
 * 회차 E2E 세션 수명주기 계약 (AUTH_SESSION_RUNTIME_CURRENT_RELEASE).
 *
 * 실제 Preview의 Auth.js 세션을 역할별로 검증한다.
 * - Credentials 로그인 후 세션 쿠키가 발급되고 같은 브라우저 컨텍스트에서 유지된다.
 * - Auth.js 로그아웃 후 세션 쿠키와 세션이 사라진다.
 * - 계정 정지·기사 승인 철회 뒤 다음 세션 조회에서 세션이 끊긴다(48A same-deployment authority).
 *
 * 로그아웃·정지는 같은 계정의 다른 세션에도 영향을 줄 수 있으므로, 이 스펙은 회차 E2E
 * 52건이 끝난 뒤 별도 단계에서만 실행한다. 사용자 상태 변경은 비운영 fixture 가드를
 * 통과한 이번 실행의 fixture 사용자에게만 적용하고 모든 경로에서 원래 값으로 복원한다.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { isAuthJsSessionCookieName, loginViaCredentials } from './_helpers/auth';
import { type RoundDirectProject, roundDirectProject } from './_helpers/round-direct';
import { resolveE2ETargetUrl } from './_helpers/target-url';

type Role = 'consumer' | 'seller' | 'driver';
type UserStatePatch = { suspended?: boolean; driverApproved?: boolean };
type UserStateModule = {
  withRoundDirectUserState: <T>(
    options: { project: RoundDirectProject; role: Role; patch: UserStatePatch },
    callback: (context: { userId: string }) => Promise<T>,
  ) => Promise<T>;
};

const USER_STATE_MODULE = pathToFileURL(
  resolve(__dirname, '../../../scripts/round-direct-e2e-user-state.mjs'),
).href;

const REVOCATIONS: Array<{ role: Role; label: string; patch: UserStatePatch }> = [
  { role: 'consumer', label: '계정 정지', patch: { suspended: true } },
  { role: 'seller', label: '계정 정지', patch: { suspended: true } },
  { role: 'driver', label: '기사 승인 철회', patch: { driverApproved: false } },
];

async function loadUserStateModule(): Promise<UserStateModule> {
  return (await import(USER_STATE_MODULE)) as UserStateModule;
}

async function login(page: Page, role: Role, project: RoundDirectProject): Promise<string> {
  const suffix = project.toUpperCase();
  const email = process.env[`TEST_${role.toUpperCase()}_EMAIL_${suffix}`];
  const password = process.env[`TEST_${role.toUpperCase()}_PASSWORD_${suffix}`];
  if (!email || !password) throw new Error(`${project} ${role} 테스트 계정 정보가 없습니다.`);
  const base = resolveE2ETargetUrl(role);
  const credentialHeader =
    role === 'driver'
      ? {
          name: 'x-round-direct-e2e-secret',
          value: process.env['ROUND_DIRECT_E2E_SHARED_SECRET'] ?? '',
        }
      : undefined;
  await loginViaCredentials(page, base, email, password, credentialHeader);
  return base;
}

async function readSessionRole(page: Page, base: string): Promise<string | null> {
  const response = await page.request.get(`${base}/api/auth/session`);
  expect(response.ok()).toBe(true);
  const body = (await response.json().catch(() => null)) as { user?: { role?: string } } | null;
  return body?.user?.role ?? null;
}

async function hasSessionCookie(page: Page, base: string): Promise<boolean> {
  const cookies = await page.context().cookies(base);
  return cookies.some(({ name }) => isAuthJsSessionCookieName(name));
}

async function signOut(page: Page, base: string): Promise<void> {
  const csrf = await page.request.get(`${base}/api/auth/csrf`);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const response = await page.request.post(`${base}/api/auth/signout`, {
    form: { csrfToken, callbackUrl: base },
    maxRedirects: 0,
  });
  expect(response.status()).toBeLessThan(400);
}

// 일반 E2E(e2e.yml)는 '회차 직배송' 제목을 --grep-invert로 제외하므로 이 스펙은 회차 E2E에서만 돈다.
test.describe('회차 직배송 세션 수명주기 계약', () => {
  for (const { role } of REVOCATIONS) {
    test(`${role} 세션은 쿠키로 유지되고 로그아웃하면 사라진다`, async ({ page }, testInfo) => {
      const project = roundDirectProject(testInfo);
      const base = await login(page, role, project);

      expect(await hasSessionCookie(page, base)).toBe(true);
      expect(await readSessionRole(page, base)).toBe(role);

      await page.goto(base);
      expect(await hasSessionCookie(page, base)).toBe(true);
      expect(await readSessionRole(page, base)).toBe(role);

      await signOut(page, base);
      expect(await hasSessionCookie(page, base)).toBe(false);
      expect(await readSessionRole(page, base)).toBeNull();
    });
  }

  for (const { role, label, patch } of REVOCATIONS) {
    test(`${role} ${label} 뒤 다음 세션 조회에서 세션이 끊긴다`, async ({ page }, testInfo) => {
      const project = roundDirectProject(testInfo);
      const base = await login(page, role, project);
      expect(await readSessionRole(page, base)).toBe(role);

      const { withRoundDirectUserState } = await loadUserStateModule();
      await withRoundDirectUserState({ project, role, patch }, async () => {
        expect(await readSessionRole(page, base)).toBeNull();
        expect(await hasSessionCookie(page, base)).toBe(false);
      });

      // 복원 뒤 같은 계정으로 다시 로그인할 수 있어야 다음 실행과 수동 점검에 영향이 없다.
      await login(page, role, project);
      expect(await readSessionRole(page, base)).toBe(role);
    });
  }
});
