import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// `refreshTokens/{sub}`에는 refresh token 원문 대신 SHA-256(hex)을 저장한다.
// 배포 전에 저장된 원문 기록은 해시 형식이 아니므로 원문과 한 번 비교하고, 맞으면
// 다음 회전에서 해시 기록으로 바뀐다.
const REFRESH_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

// 저장값과 제시된 refresh token이 같은지 timing-safe로 비교한다.
export function matchesStoredRefreshToken(stored: unknown, presented: string): boolean {
  if (typeof stored !== 'string' || stored.length === 0) return false;
  if (REFRESH_TOKEN_HASH_PATTERN.test(stored)) {
    return timingSafeEqual(
      Buffer.from(hashRefreshToken(presented), 'hex'),
      Buffer.from(stored, 'hex'),
    );
  }
  // 배포 전 원문 기록: 길이가 달라도 같은 시간에 비교하도록 양쪽 digest를 비교한다.
  return timingSafeEqual(digest(presented), digest(stored));
}

export function isHashedRefreshTokenRecord(stored: unknown): boolean {
  return typeof stored === 'string' && REFRESH_TOKEN_HASH_PATTERN.test(stored);
}

// 회전 유예(같은 세션의 동시 갱신) 동안 직전 토큰을 다시 보낸 요청에 현재 토큰을 돌려주려면
// 원문이 필요하다. 원문 대신 직전 토큰에서 만든 키로 현재 토큰을 암호화해 두고, 직전 토큰을
// 제시한 요청만 풀 수 있게 한다. 키는 저장된 해시(SHA-256(직전 토큰))와 다른 값이다.
const GRACE_KEY_CONTEXT = 'greenhub.refresh-rotation-grace.v1\0';
const GRACE_SEAL_VERSION = 'v1';

function graceKey(previousToken: string): Buffer {
  return createHash('sha256')
    .update(GRACE_KEY_CONTEXT, 'utf8')
    .update(previousToken, 'utf8')
    .digest();
}

export function sealRotatedRefreshToken(currentToken: string, previousToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', graceKey(previousToken), iv);
  const ciphertext = Buffer.concat([cipher.update(currentToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    GRACE_SEAL_VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

// 풀 수 없으면(다른 토큰·손상된 기록) null.
export function openRotatedRefreshToken(sealed: unknown, previousToken: string): string | null {
  if (typeof sealed !== 'string') return null;
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== GRACE_SEAL_VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', graceKey(previousToken), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
