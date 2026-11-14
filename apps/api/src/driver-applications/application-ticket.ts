import type { JwtService } from "@nestjs/jwt";
import { JWT_ALGORITHM } from "../auth/token-claims";

// 기사 가입 신청 티켓. 승인 전 기사의 카카오 로그인 거절(403 DRIVER_APPROVAL_PENDING) 응답에 실어,
// 세션 없이 자기 신청 정보만 읽고 쓰게 한다(`GET·PUT /driver-applications/me`).
// access token과 같은 JWT_SECRET으로 서명하지만 종류(typ)·수신자(aud)가 달라 access token으로는
// 쓰이지 않는다(JwtStrategy·ClientThrottlerGuard의 hasExpectedTokenClaims가 거부).
export const DRIVER_APPLICATION_TICKET_TYPE = "driver_application";
export const DRIVER_APPLICATION_TICKET_AUDIENCE = "greenhub-driver-application";
export const DRIVER_APPLICATION_TICKET_TTL_SECONDS = 30 * 60;

const MAX_SUBJECT_LENGTH = 128;

export function signDriverApplicationTicket(
  jwt: JwtService,
  secret: string | undefined,
  userId: string,
): string {
  return jwt.sign(
    { sub: userId, typ: DRIVER_APPLICATION_TICKET_TYPE },
    {
      secret,
      expiresIn: DRIVER_APPLICATION_TICKET_TTL_SECONDS,
      algorithm: JWT_ALGORITHM,
      audience: DRIVER_APPLICATION_TICKET_AUDIENCE,
    },
  );
}

/** 서명·만료·종류·수신자가 맞으면 티켓의 사용자 id, 아니면 null. */
export function verifyDriverApplicationTicket(
  jwt: JwtService,
  secret: string | undefined,
  token: unknown,
): string | null {
  if (
    typeof token !== "string" ||
    !token ||
    typeof secret !== "string" ||
    !secret
  )
    return null;
  try {
    const payload = jwt.verify<{ sub?: unknown; typ?: unknown; aud?: unknown }>(
      token,
      {
        secret,
        algorithms: [JWT_ALGORITHM],
        audience: DRIVER_APPLICATION_TICKET_AUDIENCE,
      },
    );
    if (payload.typ !== DRIVER_APPLICATION_TICKET_TYPE) return null;
    if (payload.aud !== DRIVER_APPLICATION_TICKET_AUDIENCE) return null;
    const sub = payload.sub;
    if (typeof sub !== "string" || !sub || sub.length > MAX_SUBJECT_LENGTH)
      return null;
    return sub;
  } catch {
    return null;
  }
}

/** `Authorization: Bearer <티켓>` 헤더에서 티켓을 꺼낸다. */
export function bearerFromHeaders(
  headers: Record<string, unknown> | undefined,
): string | undefined {
  const header = headers?.["authorization"];
  if (typeof header !== "string") return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
