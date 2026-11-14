import { createMemoryFirestore } from "../common/testing/memory-firestore";
import { DRIVER_APPLICATION_CHANGED } from "../driver-applications/driver-application.record";
import { AdminService } from "./admin.service";
import { ApproveDriverDto } from "./dto/admin.dto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

jest.mock("firebase-admin", () => ({ auth: jest.fn() }));

// 관리자가 본 가입 신청 회차(expectedRevision)로 승인을 낙관적 동시성 검사한다.
function makeService(user: Record<string, unknown>) {
  const { firestore, records } = createMemoryFirestore({
    "users/driver-1": user,
  });
  const audit = {
    logAdmin: jest.fn().mockResolvedValue(undefined),
    listAdmin: jest.fn(),
  };
  const service = new AdminService(
    firestore as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
  );
  return { service, records, audit };
}

const PENDING = {
  id: "driver-1",
  role: "driver",
  driverApproved: false,
  suspended: false,
};
const withApplication = (revision: number) => ({
  ...PENDING,
  driverApplication: {
    realName: "김기사",
    phone: "01012345678",
    status: "submitted",
    revision,
  },
});

describe("기사 승인과 가입 신청 회차", () => {
  it("관리자가 본 회차와 저장된 회차가 같으면 승인하고 그 회차를 감사 기록에 남긴다", async () => {
    const { service, records, audit } = makeService(withApplication(3));

    await expect(
      service.approveDriver("driver-1", "admin-1", 3),
    ).resolves.toEqual({
      userId: "driver-1",
      driverApproved: true,
    });
    expect(records.get("users/driver-1")).toMatchObject({
      driverApproved: true,
    });
    expect(audit.logAdmin).toHaveBeenCalledWith({
      action: "admin.driver.approved",
      actorId: "admin-1",
      targetType: "driver",
      targetId: "driver-1",
      before: { driverApproved: false, applicationRevision: 3 },
      after: { driverApproved: true },
    });
    // 신청 값(실명·휴대폰)은 감사 기록에 남기지 않는다.
    expect(JSON.stringify(audit.logAdmin.mock.calls)).not.toContain(
      "01012345678",
    );
  });

  it("그 사이 기사가 신청을 고쳤으면 409 DRIVER_APPLICATION_CHANGED로 거절하고 승인하지 않는다", async () => {
    const { service, records, audit } = makeService(withApplication(4));

    await expect(
      service.approveDriver("driver-1", "admin-1", 3),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: DRIVER_APPLICATION_CHANGED },
    });
    expect(records.get("users/driver-1")).toMatchObject({
      driverApproved: false,
    });
    expect(audit.logAdmin).not.toHaveBeenCalled();
  });

  it("신청 정보 없이 본 화면(회차 0)인데 그 사이 신청이 들어왔으면 409로 거절한다", async () => {
    const { service } = makeService(withApplication(1));

    await expect(
      service.approveDriver("driver-1", "admin-1", 0),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it.each([
    ["회차 0을 보낸 경우", 0],
    ["회차를 보내지 않은 이전 화면", undefined],
  ])(
    "신청 정보가 없는 기존 대기 계정도 승인할 수 있다(%s)",
    async (_label, expected) => {
      const { service, records, audit } = makeService(PENDING);

      await service.approveDriver("driver-1", "admin-1", expected);

      expect(records.get("users/driver-1")).toMatchObject({
        driverApproved: true,
      });
      expect(audit.logAdmin.mock.calls[0][0].before).toEqual({
        driverApproved: false,
        applicationRevision: null,
      });
    },
  );

  it("회차를 보내지 않으면 비교하지 않는다(이전 화면 호환)", async () => {
    const { service, records } = makeService(withApplication(5));
    await service.approveDriver("driver-1", "admin-1");
    expect(records.get("users/driver-1")).toMatchObject({
      driverApproved: true,
    });
  });

  it("승인 본문은 0 이상의 정수 회차만 받는다", () => {
    const errorsOf = (body: unknown) =>
      validateSync(plainToInstance(ApproveDriverDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    expect(errorsOf({})).toHaveLength(0);
    expect(errorsOf({ expectedRevision: 0 })).toHaveLength(0);
    expect(errorsOf({ expectedRevision: 2 })).toHaveLength(0);
    expect(errorsOf({ expectedRevision: -1 })).not.toHaveLength(0);
    expect(errorsOf({ expectedRevision: 1.5 })).not.toHaveLength(0);
    expect(errorsOf({ expectedRevision: "2" })).not.toHaveLength(0);
    expect(errorsOf({ expectedRevision: 1, extra: true })).not.toHaveLength(0);
  });
});
