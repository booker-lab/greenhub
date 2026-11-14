import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import {
  DRIVER_APPLICATION_CONSENT_VERSION,
  DRIVER_APPLICATION_MAX_REVISION,
} from "@greenhub/shared";
import request from "supertest";
import type { App } from "supertest/types";
import { JWT_ALGORITHM, JWT_AUDIENCE } from "../auth/token-claims";
import { AuditService } from "../common/audit/audit.service";
import { createMemoryFirestore } from "../common/testing/memory-firestore";
import { sanitizedValidationPipeOptions } from "../common/validation/sanitized-validation";
import { FirestoreService } from "../firestore/firestore.service";
import { signDriverApplicationTicket } from "./application-ticket";
import {
  DRIVER_ALREADY_APPROVED,
  DRIVER_APPLICATION_NOT_ALLOWED,
  DRIVER_APPLICATION_TICKET_INVALID,
  DriverApplicationTicketGuard,
} from "./driver-application-ticket.guard";
import { DriverApplicationsController } from "./driver-applications.controller";
import {
  DRIVER_APPLICATION_REVISION_LIMIT,
  DriverApplicationsService,
} from "./driver-applications.service";

const SECRET = "driver-applications-spec-secret";
const signer = new JwtService();

const PENDING_DRIVER = {
  id: "driver-1",
  role: "driver",
  name: "kakao-4242",
  driverApproved: false,
  suspended: false,
};

const VALID_BODY = {
  realName: "김기사",
  phone: "01012345678",
  vehicleType: "van",
  availableDays: ["mon", "sat"],
  availableArea: "이천시 전역",
  consent: true,
  consentVersion: DRIVER_APPLICATION_CONSENT_VERSION,
};

async function createApp(users: Record<string, Record<string, unknown>>) {
  const { firestore, records } = createMemoryFirestore(
    Object.fromEntries(
      Object.entries(users).map(([id, data]) => [`users/${id}`, data]),
    ),
  );
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = await Test.createTestingModule({
    controllers: [DriverApplicationsController],
    providers: [
      DriverApplicationsService,
      DriverApplicationTicketGuard,
      JwtService,
      {
        provide: ConfigService,
        useValue: new ConfigService({ JWT_SECRET: SECRET }),
      },
      { provide: FirestoreService, useValue: firestore },
      { provide: AuditService, useValue: audit },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
  await app.init();
  return { app, records, audit };
}

const ticketFor = (userId: string) =>
  signDriverApplicationTicket(signer, SECRET, userId);

describe("기사 가입 신청 티켓 가드", () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app?.close();
  });

  it.each([
    ["티켓 없음", undefined],
    [
      "access token",
      signer.sign(
        { sub: "driver-1", role: "driver", typ: "access" },
        { secret: SECRET, algorithm: JWT_ALGORITHM, audience: JWT_AUDIENCE },
      ),
    ],
    [
      "다른 secret의 티켓",
      signDriverApplicationTicket(signer, "other-secret", "driver-1"),
    ],
  ])("%s는 401 %s로 거절한다", async (_label, token) => {
    ({ app } = await createApp({ "driver-1": PENDING_DRIVER }));
    const req = request(app.getHttpServer()).get("/driver-applications/me");
    const res = await (token
      ? req.set("Authorization", `Bearer ${token}`)
      : req);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(DRIVER_APPLICATION_TICKET_INVALID);
  });

  it.each([
    [
      "이미 승인된 기사",
      { ...PENDING_DRIVER, driverApproved: true },
      403,
      DRIVER_ALREADY_APPROVED,
    ],
    [
      "정지된 기사",
      { ...PENDING_DRIVER, suspended: true },
      403,
      DRIVER_APPLICATION_NOT_ALLOWED,
    ],
    [
      "기사가 아닌 계정",
      { ...PENDING_DRIVER, role: "consumer" },
      403,
      DRIVER_APPLICATION_NOT_ALLOWED,
    ],
    [
      "탈퇴한 계정",
      { ...PENDING_DRIVER, withdrawnAt: 1 },
      401,
      DRIVER_APPLICATION_TICKET_INVALID,
    ],
  ])(
    "요청마다 사용자 문서를 다시 읽어 %s는 거절한다",
    async (_label, user, status, code) => {
      ({ app } = await createApp({ "driver-1": user }));
      for (const send of [
        () => request(app.getHttpServer()).get("/driver-applications/me"),
        () =>
          request(app.getHttpServer())
            .put("/driver-applications/me")
            .send(VALID_BODY),
      ]) {
        const res = await send().set(
          "Authorization",
          `Bearer ${ticketFor("driver-1")}`,
        );
        expect(res.status).toBe(status);
        expect(res.body.code).toBe(code);
      }
    },
  );

  it("사용자 문서가 사라진 티켓은 401로 거절한다", async () => {
    ({ app } = await createApp({}));
    const res = await request(app.getHttpServer())
      .get("/driver-applications/me")
      .set("Authorization", `Bearer ${ticketFor("driver-1")}`);
    expect(res.status).toBe(401);
  });
});

describe("기사 가입 신청 조회·저장", () => {
  let app: INestApplication<App>;
  let records: Map<string, Record<string, any>>;
  let audit: { log: jest.Mock };

  afterEach(async () => {
    await app?.close();
  });

  const get = () =>
    request(app.getHttpServer())
      .get("/driver-applications/me")
      .set("Authorization", `Bearer ${ticketFor("driver-1")}`);
  const put = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .put("/driver-applications/me")
      .set("Authorization", `Bearer ${ticketFor("driver-1")}`)
      .send(body);

  it("신청 전에는 none과 실명 처음 값을 준다(자동 생성 카카오 이름은 비운다)", async () => {
    ({ app } = await createApp({ "driver-1": PENDING_DRIVER }));
    const res = await get().expect(200);
    expect(res.body).toEqual({
      status: "none",
      application: null,
      prefill: { realName: "" },
    });

    await app.close();
    ({ app } = await createApp({
      "driver-1": { ...PENDING_DRIVER, name: "김기사" },
    }));
    expect((await get().expect(200)).body.prefill).toEqual({
      realName: "김기사",
    });
  });

  it.each([
    ["모르는 칸(차량 번호)", { ...VALID_BODY, vehicleNumber: "12가3456" }],
    ["모르는 칸(메모)", { ...VALID_BODY, memo: "자유 메모" }],
    ["하이픈 있는 휴대폰", { ...VALID_BODY, phone: "010-1234-5678" }],
    ["010이 아닌 번호", { ...VALID_BODY, phone: "01112345678" }],
    ["한 글자 실명", { ...VALID_BODY, realName: "김" }],
    ["21자 실명", { ...VALID_BODY, realName: "가".repeat(21) }],
    ["숫자 실명", { ...VALID_BODY, realName: "김기사1" }],
    ["모르는 차량 종류", { ...VALID_BODY, vehicleType: "bicycle" }],
    ["모르는 요일", { ...VALID_BODY, availableDays: ["holiday"] }],
    ["중복 요일", { ...VALID_BODY, availableDays: ["mon", "mon"] }],
    ["101자 지역", { ...VALID_BODY, availableArea: "가".repeat(101) }],
    ["줄바꿈 지역", { ...VALID_BODY, availableArea: "이천\n여주" }],
    ["동의 안 함", { ...VALID_BODY, consent: false }],
    ["동의 칸 없음", { ...VALID_BODY, consent: undefined }],
    ["다른 동의 문안 버전", { ...VALID_BODY, consentVersion: "old-version" }],
  ])("%s는 400으로 거절하고 저장하지 않는다", async (_label, body) => {
    ({ app, records, audit } = await createApp({ "driver-1": PENDING_DRIVER }));
    await put(body).expect(400);
    expect(records.get("users/driver-1")).not.toHaveProperty(
      "driverApplication",
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("처음 저장하면 회차 1로 저장하고, 감사 기록에는 칸 이름과 회차만 남긴다", async () => {
    ({ app, records, audit } = await createApp({ "driver-1": PENDING_DRIVER }));
    const res = await put({
      ...VALID_BODY,
      availableDays: ["sat", "mon"],
      availableArea: " 이천시 전역 ",
    }).expect(200);

    const stored = records.get("users/driver-1")!["driverApplication"];
    expect(stored).toMatchObject({
      realName: "김기사",
      phone: "01012345678",
      vehicleType: "van",
      availableDays: ["mon", "sat"],
      availableArea: "이천시 전역",
      consentVersion: DRIVER_APPLICATION_CONSENT_VERSION,
      status: "submitted",
      revision: 1,
    });
    expect(stored.consentedAt).toBeDefined();
    expect(stored.submittedAt).toBe(stored.updatedAt);
    // 승인 상태는 바꾸지 않는다.
    expect(records.get("users/driver-1")).toMatchObject({
      driverApproved: false,
    });
    expect(res.body).toMatchObject({
      status: "submitted",
      application: { revision: 1 },
    });

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith("driver.application.submitted", {
      userId: "driver-1",
      detail: {
        revision: 1,
        changedFields: [
          "realName",
          "phone",
          "vehicleType",
          "availableDays",
          "availableArea",
          "consentVersion",
        ],
      },
    });
    const logged = JSON.stringify(audit.log.mock.calls);
    for (const value of ["김기사", "01012345678", "이천시"])
      expect(logged).not.toContain(value);

    const after = await get().expect(200);
    expect(after.body.status).toBe("submitted");
    expect(after.body.application).toMatchObject({
      realName: "김기사",
      revision: 1,
    });
  });

  it("고치면 회차를 올리고 바뀐 칸 이름만 남기며, 처음 신청 시각은 그대로 둔다", async () => {
    ({ app, records, audit } = await createApp({ "driver-1": PENDING_DRIVER }));
    await put(VALID_BODY).expect(200);
    const first = records.get("users/driver-1")!["driverApplication"];

    const { availableArea: _area, ...withoutArea } = VALID_BODY;
    await put({ ...withoutArea, phone: "01098765432" }).expect(200);

    const second = records.get("users/driver-1")!["driverApplication"];
    expect(second).toMatchObject({
      revision: 2,
      phone: "01098765432",
      availableArea: null,
    });
    expect(second.submittedAt).toBe(first.submittedAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(audit.log).toHaveBeenLastCalledWith("driver.application.updated", {
      userId: "driver-1",
      detail: { revision: 2, changedFields: ["phone", "availableArea"] },
    });
  });

  it("바뀐 칸이 없으면 회차를 올리지 않고 감사 기록도 남기지 않는다", async () => {
    ({ app, records, audit } = await createApp({ "driver-1": PENDING_DRIVER }));
    await put(VALID_BODY).expect(200);
    await put(VALID_BODY).expect(200);
    expect(records.get("users/driver-1")!["driverApplication"].revision).toBe(
      1,
    );
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it(`회차가 상한(${DRIVER_APPLICATION_MAX_REVISION})에 이르면 더 고치지 못하게 409로 거절한다`, async () => {
    ({ app, records, audit } = await createApp({
      "driver-1": {
        ...PENDING_DRIVER,
        driverApplication: {
          ...VALID_BODY,
          consent: undefined,
          status: "submitted",
          revision: DRIVER_APPLICATION_MAX_REVISION,
        },
      },
    }));
    const res = await put({ ...VALID_BODY, phone: "01098765432" }).expect(409);
    expect(res.body.code).toBe(DRIVER_APPLICATION_REVISION_LIMIT);
    expect(records.get("users/driver-1")!["driverApplication"].phone).toBe(
      "01012345678",
    );
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe("기사 가입 신청 저장 트랜잭션 재확인", () => {
  it("가드 뒤 관리자가 먼저 승인했으면 저장하지 않고 403으로 거절한다", async () => {
    const { firestore, records } = createMemoryFirestore({
      "users/driver-1": { ...PENDING_DRIVER, driverApproved: true },
    });
    const audit = { log: jest.fn() };
    const service = new DriverApplicationsService(
      firestore as never,
      audit as never,
    );

    await expect(
      service.upsertMine("driver-1", VALID_BODY as never),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: DRIVER_ALREADY_APPROVED },
    });
    expect(records.get("users/driver-1")).not.toHaveProperty(
      "driverApplication",
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("감사 기록이 실패해도 저장한 신청을 실패로 돌리지 않는다", async () => {
    const { firestore, records } = createMemoryFirestore({
      "users/driver-1": PENDING_DRIVER,
    });
    const audit = { log: jest.fn().mockRejectedValue(new Error("audit down")) };
    const service = new DriverApplicationsService(
      firestore as never,
      audit as never,
    );

    await expect(
      service.upsertMine("driver-1", VALID_BODY as never),
    ).resolves.toMatchObject({
      status: "submitted",
    });
    expect(records.get("users/driver-1")!["driverApplication"].revision).toBe(
      1,
    );
  });
});
