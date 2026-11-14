import type { DriverApplicationStatus } from "@greenhub/shared";
import { isWithdrawnUser } from "../auth/account-withdrawal";

// `users/{uid}.driverApplication` 칸 이름. 승인 전 기사가 기사 앱 `/apply`에서 낸 신청 정보다.
export const DRIVER_APPLICATION_FIELD = "driverApplication";

// 신청 정보 중 바뀌었는지 비교해 감사 기록에 이름만 남기는 칸(값은 남기지 않는다).
export const DRIVER_APPLICATION_COMPARED_FIELDS = [
  "realName",
  "phone",
  "vehicleType",
  "availableDays",
  "availableArea",
  "consentVersion",
] as const;

export type DriverApplicationComparedField =
  (typeof DRIVER_APPLICATION_COMPARED_FIELDS)[number];

type UserRecord = Record<string, unknown> | undefined;

// 관리자 승인에서 본 신청 회차(expectedRevision)와 저장된 회차가 다를 때 붙이는 code(409).
// 관리자 화면이 같은 값을 읽어 "신청 내용이 바뀌었어요" 안내 뒤 목록을 다시 읽는다.
export const DRIVER_APPLICATION_CHANGED = "DRIVER_APPLICATION_CHANGED";

/** 저장된 신청 칸. 형식이 다르면(옛 데이터·손상) 신청이 없는 것으로 본다. */
export function readDriverApplication(
  user: UserRecord,
): Record<string, unknown> | null {
  const value = user?.[DRIVER_APPLICATION_FIELD];
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const record = value as Record<string, unknown>;
  return record["status"] === "submitted" ? record : null;
}

export function driverApplicationStatusOf(
  user: UserRecord,
): DriverApplicationStatus {
  return readDriverApplication(user) ? "submitted" : "none";
}

/** 저장된 신청의 회차(revision). 신청이 없으면 0. */
export function driverApplicationRevisionOf(user: UserRecord): number {
  const revision = readDriverApplication(user)?.["revision"];
  return typeof revision === "number" &&
    Number.isInteger(revision) &&
    revision > 0
    ? revision
    : 0;
}

/**
 * 가입 신청을 읽고 쓸 수 있는 계정인지(티켓 발급·티켓 경로 공통). 탈퇴·정지·기사가 아닌 계정·이미 승인된 기사는 아니다.
 */
export type DriverApplicantState =
  | "pending"
  | "missing"
  | "withdrawn"
  | "not_driver"
  | "suspended"
  | "approved";

export function driverApplicantState(user: UserRecord): DriverApplicantState {
  if (!user) return "missing";
  if (isWithdrawnUser(user)) return "withdrawn";
  if (user["role"] !== "driver") return "not_driver";
  if (user["suspended"] === true) return "suspended";
  if (user["driverApproved"] === true) return "approved";
  return "pending";
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => item === b[index])
    );
  }
  return (a ?? null) === (b ?? null);
}

/** 이전 신청과 비교해 바뀐 칸 이름 목록. 이전 신청이 없으면 모든 칸. */
export function changedDriverApplicationFields(
  previous: Record<string, unknown> | null,
  next: Record<DriverApplicationComparedField, unknown>,
): DriverApplicationComparedField[] {
  return DRIVER_APPLICATION_COMPARED_FIELDS.filter(
    (field) => previous === null || !sameValue(previous[field], next[field]),
  );
}

// 응답에 싣는 신청 칸. 저장 문서를 통째로 내려주지 않는다.
const VIEW_FIELDS = [
  "realName",
  "phone",
  "vehicleType",
  "availableDays",
  "availableArea",
  "consentVersion",
  "consentedAt",
  "status",
  "revision",
  "submittedAt",
  "updatedAt",
] as const;

export function toDriverApplicationView(
  record: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!record) return null;
  const view: Record<string, unknown> = {};
  for (const field of VIEW_FIELDS) view[field] = record[field] ?? null;
  if (!Array.isArray(view["availableDays"])) view["availableDays"] = [];
  return view;
}
