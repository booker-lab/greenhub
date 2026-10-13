import type { Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

// `users/{uid}.sessionsRevokedAt`: 이 시각 이전에 발급된 API access token을 거부한다.
// JWT `iat`는 초 단위이므로 기록 시각을 초 단위로 내려 둔다. 그래야 폐기 직후 같은 초에
// 새로 로그인해 받은 토큰(iat * 1000 === 기록 시각)이 통과한다.
export const SESSIONS_REVOKED_AT_FIELD = 'sessionsRevokedAt';

export function sessionsRevokedAtMillis(nowMillis: number = Date.now()): number {
  return Math.floor(nowMillis / 1000) * 1000;
}

type TimestampLike = { toMillis: () => number };

function isTimestampLike(value: unknown): value is TimestampLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  );
}

// 사용자 문서의 폐기 시각 이전에 발급된 access token인지 판정한다.
// 폐기 기록이 없으면 통과, 형식을 알 수 없는 기록이나 iat 없는 토큰은 거부(fail closed)한다.
export function isIssuedBeforeSessionRevocation(
  iatSeconds: unknown,
  sessionsRevokedAt: unknown,
): boolean {
  if (sessionsRevokedAt === undefined || sessionsRevokedAt === null) return false;
  if (!isTimestampLike(sessionsRevokedAt)) return true;
  const revokedAtMillis = sessionsRevokedAt.toMillis();
  if (!Number.isFinite(revokedAtMillis)) return true;
  if (typeof iatSeconds !== 'number' || !Number.isFinite(iatSeconds)) return true;
  return iatSeconds * 1000 < revokedAtMillis;
}

// `/auth/firebase-token`으로 시작한 Firebase 클라이언트 세션의 갱신을 끊는다. 이미 발급된
// Firebase ID 토큰은 만료(최대 1시간)까지 남는다. custom token을 받은 적 없는 사용자는 Firebase
// 사용자 기록이 없으므로 끊을 세션도 없다. 그 밖의 실패는 API 세션 폐기를 되돌리지 않고 기록만 남긴다.
export async function revokeFirebaseSessions(userId: string, logger: Logger): Promise<void> {
  try {
    await admin.auth().revokeRefreshTokens(userId);
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'auth/user-not-found') return;
    logger.error(
      `auth.firebase.revoke_failed userId=${userId} error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
