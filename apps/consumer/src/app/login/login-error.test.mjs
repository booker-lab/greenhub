import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// 2026-11-26 검수: 카카오 로그인이 거부되면 Auth.js 기본 영어 화면(/api/auth/error, "Access Denied")이 보였다.
test('로그인 오류는 모두 로그인 화면으로 돌아와 한국어로 안내한다', async () => {
  const auth = await read('../../auth.ts');
  assert.match(auth, /pages: \{\s*signIn: '\/login',[\s\S]*?error: '\/login',\s*\}/);

  const form = await read('./_form.tsx');
  assert.match(
    form,
    /loginErrorMessage\(searchParams\.get\('error'\), PUBLIC_BUSINESS_INFO\.phone\)/,
  );
  // 실패 안내는 role=alert이고, 만료 안내보다 앞선다.
  assert.ok(form.indexOf('{loginError ? (') < form.indexOf(') : expired ? ('));
  assert.match(form, /<p role="alert"[^>]*>\s*\{loginError\}/);
});
