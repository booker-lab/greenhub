import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createMemoryFirestore } from "../common/testing/memory-firestore";
import { verifyDriverApplicationTicket } from "../driver-applications/application-ticket";
import { AuthService, DRIVER_APPROVAL_PENDING } from "./auth.service";

jest.mock("firebase-admin", () => ({ auth: jest.fn() }));

// 기사 앱 카카오 로그인의 승인 전 기사 거절(403 DRIVER_APPROVAL_PENDING)에 실리는 가입 신청 티켓과 신청 상태를
// 실제 JwtService로 서명·확인한다(계정 상태별 응답).
const SECRET = "kakao-login-ticket-spec-secret";
const KAKAO_ID = "4242";
const jwt = new JwtService();

function makeService(users: Record<string, Record<string, unknown>>) {
  const initial: Record<string, Record<string, unknown>> = {};
  for (const [id, data] of Object.entries(users)) {
    initial[`users/${id}`] = { id, kakaoId: KAKAO_ID, storeId: null, ...data };
    initial[`kakaoIdentities/${KAKAO_ID}`] = { userId: id };
  }
  const { firestore, records } = createMemoryFirestore(initial);
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const kakaoClient = {
    getUser: jest
      .fn()
      .mockResolvedValue({
        kakaoId: KAKAO_ID,
        email: null,
        name: "kakao-4242",
      }),
  };
  const service = new AuthService(
    firestore as never,
    jwt,
    new ConfigService({
      JWT_SECRET: SECRET,
      JWT_REFRESH_SECRET: `${SECRET}-refresh`,
    }),
    kakaoClient as never,
    audit as never,
  );
  return { service, records };
}

async function rejectionOf(
  promise: Promise<unknown>,
): Promise<{ status: number; body: any }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { getStatus: () => number; getResponse: () => unknown };
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error("거절되지 않았다");
}

describe("기사 앱 카카오 로그인의 가입 신청 티켓", () => {
  it("처음 들어온 기사는 승인 대기 계정이 만들어지고 403에 신청 티켓(sub=새 사용자)과 none을 싣는다", async () => {
    const { service, records } = makeService({});

    const { status, body } = await rejectionOf(
      service.kakaoLogin({ kakaoAccessToken: "token", targetRole: "driver" }),
    );

    expect(status).toBe(403);
    expect(body).toMatchObject({
      code: DRIVER_APPROVAL_PENDING,
      applicationStatus: "none",
    });
    const userId = verifyDriverApplicationTicket(
      jwt,
      SECRET,
      body.applicationTicket,
    );
    expect(userId).toBeTruthy();
    expect(records.get(`users/${userId}`)).toMatchObject({
      role: "driver",
      driverApproved: false,
    });
    expect(records.has(`refreshTokens/${userId}`)).toBe(false);
  });

  it("신청을 낸 승인 대기 기사는 submitted 상태와 새 티켓을 받는다", async () => {
    const { service } = makeService({
      "driver-1": {
        role: "driver",
        driverApproved: false,
        driverApplication: { status: "submitted", revision: 2 },
      },
    });

    const { status, body } = await rejectionOf(
      service.kakaoLogin({ kakaoAccessToken: "token", targetRole: "driver" }),
    );

    expect(status).toBe(403);
    expect(body.applicationStatus).toBe("submitted");
    expect(
      verifyDriverApplicationTicket(jwt, SECRET, body.applicationTicket),
    ).toBe("driver-1");
  });

  it("승인된 기사는 티켓 없이 세션 토큰을 받는다", async () => {
    const { service } = makeService({
      "driver-1": { role: "driver", driverApproved: true },
    });

    const result = await service.kakaoLogin({
      kakaoAccessToken: "token",
      targetRole: "driver",
    });

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result).not.toHaveProperty("applicationTicket");
  });

  it("정지된 승인 대기 기사는 401이고 티켓을 싣지 않는다", async () => {
    const { service } = makeService({
      "driver-1": { role: "driver", driverApproved: false, suspended: true },
    });

    const { status, body } = await rejectionOf(
      service.kakaoLogin({ kakaoAccessToken: "token", targetRole: "driver" }),
    );

    expect(status).toBe(401);
    expect(JSON.stringify(body)).not.toContain("applicationTicket");
  });

  it("탈퇴 표시가 있는 승인 대기 문서는 403 승인 대기로 거절하되 티켓을 싣지 않는다", async () => {
    const { service } = makeService({
      "driver-1": { role: "driver", driverApproved: false, withdrawnAt: 1 },
    });

    const { status, body } = await rejectionOf(
      service.kakaoLogin({ kakaoAccessToken: "token", targetRole: "driver" }),
    );

    expect(status).toBe(403);
    expect(body.code).toBe(DRIVER_APPROVAL_PENDING);
    expect(body).not.toHaveProperty("applicationTicket");
    expect(body).not.toHaveProperty("applicationStatus");
  });
});
