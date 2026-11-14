import { ConflictException, Injectable, Logger } from "@nestjs/common";
import {
  DRIVER_APPLICATION_MAX_REVISION,
  type DriverApplicationStatus,
  driverApplicationRealNamePrefill,
  sortDriverAvailableDays,
} from "@greenhub/shared";
import { AuditService } from "../common/audit/audit.service";
import { FirestoreService } from "../firestore/firestore.service";
import {
  applicantStateRejection,
  type DriverApplicant,
} from "./driver-application-ticket.guard";
import {
  DRIVER_APPLICATION_FIELD,
  changedDriverApplicationFields,
  driverApplicantState,
  driverApplicationRevisionOf,
  driverApplicationStatusOf,
  readDriverApplication,
  toDriverApplicationView,
} from "./driver-application.record";
import type { UpsertDriverApplicationDto } from "./dto/upsert-driver-application.dto";

// 수정 횟수 상한을 넘었을 때 붙이는 code. 기사 앱이 운영팀 문의 안내로 바꾼다.
export const DRIVER_APPLICATION_REVISION_LIMIT =
  "DRIVER_APPLICATION_REVISION_LIMIT";

type UpsertOutcome =
  | { kind: "unchanged"; record: Record<string, unknown> }
  | {
      kind: "submitted" | "updated";
      record: Record<string, unknown>;
      changedFields: string[];
      revision: number;
    };

@Injectable()
export class DriverApplicationsService {
  private readonly logger = new Logger(DriverApplicationsService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly audit: AuditService,
  ) {}

  // 가드가 방금 읽은 사용자 문서로 답한다. 실명 처음 값은 카카오 이름이 자동 생성 이름이 아닐 때만 준다.
  getMine(applicant: DriverApplicant): {
    status: DriverApplicationStatus;
    application: Record<string, unknown> | null;
    prefill: { realName: string };
  } {
    return {
      status: driverApplicationStatusOf(applicant.user),
      application: toDriverApplicationView(
        readDriverApplication(applicant.user),
      ),
      prefill: {
        realName: driverApplicationRealNamePrefill(applicant.user["name"]),
      },
    };
  }

  // 신청을 내거나 고친다. 관리자 승인과 겹쳐도 한쪽만 이기도록 사용자 문서를 트랜잭션 안에서 다시 읽어
  // 승인 전·정지 아님을 다시 확인한다. 바뀐 칸이 없으면 회차(revision)를 올리지 않는다.
  async upsertMine(userId: string, dto: UpsertDriverApplicationDto) {
    const ref = this.firestore.doc(`users/${userId}`);
    const outcome = await this.firestore.runTransaction<UpsertOutcome>(
      async (tx) => {
        const snap = await tx.get(ref);
        const user = snap.exists
          ? (snap.data() as Record<string, unknown>)
          : undefined;
        const rejection = applicantStateRejection(driverApplicantState(user));
        if (rejection) throw rejection;

        const previous = readDriverApplication(user);
        const next = {
          realName: dto.realName,
          phone: dto.phone,
          vehicleType: dto.vehicleType,
          availableDays: sortDriverAvailableDays(dto.availableDays ?? []),
          availableArea: dto.availableArea?.trim() || null,
          consentVersion: dto.consentVersion,
        };
        const changedFields = changedDriverApplicationFields(previous, next);
        if (previous && changedFields.length === 0)
          return { kind: "unchanged", record: previous };

        const previousRevision = driverApplicationRevisionOf(user);
        if (previousRevision >= DRIVER_APPLICATION_MAX_REVISION) {
          throw new ConflictException({
            statusCode: 409,
            message: "가입 신청을 더 고칠 수 없습니다. 운영팀에 문의해 주세요.",
            error: "Conflict",
            code: DRIVER_APPLICATION_REVISION_LIMIT,
          });
        }

        const now = this.firestore.Timestamp.now();
        const record: Record<string, unknown> = {
          ...next,
          // 신청을 낼 때마다 그 시점의 문안 버전에 다시 동의한다.
          consentedAt: now,
          status: "submitted",
          revision: previousRevision + 1,
          submittedAt: previous?.["submittedAt"] ?? now,
          updatedAt: now,
        };
        tx.update(ref, { [DRIVER_APPLICATION_FIELD]: record, updatedAt: now });
        return {
          kind: previous ? "updated" : "submitted",
          record,
          changedFields,
          revision: previousRevision + 1,
        };
      },
    );

    if (outcome.kind !== "unchanged") {
      // 감사 기록에는 바뀐 칸의 이름과 회차만 남긴다(실명·휴대폰 등 값은 남기지 않는다).
      // 기록이 실패해도 이미 저장한 신청을 실패로 돌리지 않는다.
      try {
        await this.audit.log(
          outcome.kind === "submitted"
            ? "driver.application.submitted"
            : "driver.application.updated",
          {
            userId,
            detail: {
              revision: outcome.revision,
              changedFields: outcome.changedFields,
            },
          },
        );
      } catch (error) {
        this.logger.error(
          `driver.application.audit_failed userId=${userId} error=${error instanceof Error ? error.name : "unknown"}`,
        );
      }
    }

    return {
      status: "submitted" as const,
      application: toDriverApplicationView(outcome.record),
    };
  }
}
