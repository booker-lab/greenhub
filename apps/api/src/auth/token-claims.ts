import type { JwtPayload } from './types/jwt-payload.type';

// API가 발급하는 access/refresh JWT의 서명 알고리즘과 수신자. 검증 쪽은 이 알고리즘만 받는다.
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_AUDIENCE = 'greenhub-api';

export type TokenType = NonNullable<JwtPayload['typ']>;

// 배포 전에 발급된 토큰에는 typ·aud가 없다. 그 토큰이 만료될 때까지는 claim이 없는 것을 허용하고,
// claim이 있으면 기대한 값과 정확히 같아야 한다(다른 종류의 토큰·다른 수신자는 거부).
export function hasExpectedTokenClaims(payload: unknown, expected: TokenType): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const { typ, aud } = payload as { typ?: unknown; aud?: unknown };
  if (typ !== undefined && typ !== expected) return false;
  if (aud !== undefined && aud !== JWT_AUDIENCE) return false;
  return true;
}
