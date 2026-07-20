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
