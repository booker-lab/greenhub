import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('세션이 끝나면 보던 화면을 복귀 주소로 싣고 만료 이유와 함께 로그인 화면으로 보낸다', async () => {
  const providers = await read('../providers.tsx');
  assert.doesNotMatch(providers, /callbackUrl:\s*'\/login'/);
  assert.match(
    providers,
    /buildSessionExpiredLoginUrl\(window\.location\.pathname,\s*window\.location\.search\)/,
  );
  // 토큰 오류와 API 거절 재확인, 두 로그아웃 경로가 모두 같은 주소를 쓴다.
  assert.match(providers, /tokenError\) \{\s*signOutExpired\(\);/);
  assert.match(providers, /signOut: signOutExpired,/);
});

test('로그인 화면은 세션 만료 이유가 오면 안내를 보인다', async () => {
  const form = await read('./_form.tsx');
  assert.match(form, /isSessionExpiredReason\(searchParams\.get\('reason'\)\)/);
  assert.ok(form.includes('로그인이 만료됐어요. 다시 로그인하면 보던 화면으로 돌아가요.'));
  // 복귀 주소는 기존과 같이 같은 출처 상대 경로로만 받는다.
  assert.match(form, /safeCallbackPath\(rawCallbackUrl, window\.location\.origin\)/);
});
