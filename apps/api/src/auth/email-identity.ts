import { createHash } from 'node:crypto';

// 이메일 가입 중복 방지 연결 문서 `emailIdentities/{key}`. 같은 정규화 이메일(trim·소문자)은
// 같은 키가 된다. 키는 SHA-256(hex)이라 문서 id에 쓸 수 없는 문자와 이메일 원문이 id에 드러나지 않는다.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailIdentityKey(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail, 'utf8').digest('hex');
}
