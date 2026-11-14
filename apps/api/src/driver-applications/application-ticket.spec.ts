import { JwtService } from "@nestjs/jwt";
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  hasExpectedTokenClaims,
} from "../auth/token-claims";
import {
  DRIVER_APPLICATION_TICKET_AUDIENCE,
  DRIVER_APPLICATION_TICKET_TTL_SECONDS,
  bearerFromHeaders,
  signDriverApplicationTicket,
  verifyDriverApplicationTicket,
} from "./application-ticket";

const SECRET = "driver-application-ticket-spec-secret";
const jwt = new JwtService();

describe("기사 가입 신청 티켓", () => {
  it("사용자 id·종류·수신자·30분 만료로 서명하고 같은 secret으로 확인한다", () => {
    const ticket = signDriverApplicationTicket(jwt, SECRET, "driver-1");
    const payload = jwt.decode<Record<string, unknown>>(ticket);

    expect(payload).toMatchObject({
      sub: "driver-1",
      typ: "driver_application",
      aud: DRIVER_APPLICATION_TICKET_AUDIENCE,
    });
    expect(Number(payload["exp"]) - Number(payload["iat"])).toBe(
      DRIVER_APPLICATION_TICKET_TTL_SECONDS,
    );
    expect(DRIVER_APPLICATION_TICKET_TTL_SECONDS).toBe(30 * 60);
    expect(verifyDriverApplicationTicket(jwt, SECRET, ticket)).toBe("driver-1");
  });

  it("access token 검사(hasExpectedTokenClaims)는 티켓을 access token으로 받지 않는다", () => {
    const payload = jwt.decode(
      signDriverApplicationTicket(jwt, SECRET, "driver-1"),
    );
    expect(hasExpectedTokenClaims(payload, "access")).toBe(false);
    expect(hasExpectedTokenClaims(payload, "refresh")).toBe(false);
  });

  it.each([
    [
      "다른 secret",
      () => signDriverApplicationTicket(jwt, "other-secret", "driver-1"),
    ],
    [
      "access token",
      () =>
        jwt.sign(
          { sub: "driver-1", role: "driver", typ: "access" },
          { secret: SECRET, algorithm: JWT_ALGORITHM, audience: JWT_AUDIENCE },
        ),
    ],
    [
      "수신자는 같지만 종류가 다른 토큰",
      () =>
        jwt.sign(
          { sub: "driver-1", typ: "access" },
          {
            secret: SECRET,
            algorithm: JWT_ALGORITHM,
            audience: DRIVER_APPLICATION_TICKET_AUDIENCE,
          },
        ),
    ],
    [
      "만료된 티켓",
      () =>
        jwt.sign(
          {
            sub: "driver-1",
            typ: "driver_application",
            exp: Math.floor(Date.now() / 1000) - 10,
          },
          {
            secret: SECRET,
            algorithm: JWT_ALGORITHM,
            audience: DRIVER_APPLICATION_TICKET_AUDIENCE,
          },
        ),
    ],
    [
      "HS256이 아닌 알고리즘",
      () =>
        jwt.sign(
          { sub: "driver-1", typ: "driver_application" },
          {
            secret: SECRET,
            algorithm: "HS512",
            audience: DRIVER_APPLICATION_TICKET_AUDIENCE,
          },
        ),
    ],
  ])("%s는 받지 않는다", (_label, make) => {
    expect(verifyDriverApplicationTicket(jwt, SECRET, make())).toBeNull();
  });

  it("비어 있거나 문자열이 아닌 값, secret 없음은 받지 않는다", () => {
    const ticket = signDriverApplicationTicket(jwt, SECRET, "driver-1");
    expect(verifyDriverApplicationTicket(jwt, SECRET, "")).toBeNull();
    expect(verifyDriverApplicationTicket(jwt, SECRET, undefined)).toBeNull();
    expect(verifyDriverApplicationTicket(jwt, undefined, ticket)).toBeNull();
  });

  it("Bearer 헤더에서만 티켓을 꺼낸다", () => {
    expect(bearerFromHeaders({ authorization: "Bearer abc.def" })).toBe(
      "abc.def",
    );
    expect(bearerFromHeaders({ authorization: "Basic abc" })).toBeUndefined();
    expect(bearerFromHeaders({})).toBeUndefined();
  });
});
