import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { FirestoreService } from "../firestore/firestore.service";
import {
  bearerFromHeaders,
  verifyDriverApplicationTicket,
} from "./application-ticket";
import {
  type DriverApplicantState,
  driverApplicantState,
} from "./driver-application.record";

// 티켓 경로 거절 code. 기사 앱 `/apply`가 같은 값을 읽어 안내를 고른다(`apps/driver/src/lib/driver-application-api.ts`).
// 티켓이 없거나 만료·위조됐거나 계정이 사라짐(탈퇴 포함) → 401, 카카오로 다시 로그인 안내.
export const DRIVER_APPLICATION_TICKET_INVALID =
  "DRIVER_APPLICATION_TICKET_INVALID";
// 이미 승인된 기사 → 403, 기사 앱은 작업 보드로 보낸다.
export const DRIVER_ALREADY_APPROVED = "DRIVER_ALREADY_APPROVED";
// 기사가 아닌 계정·정지된 기사 → 403, 운영팀 문의 안내.
export const DRIVER_APPLICATION_NOT_ALLOWED = "DRIVER_APPLICATION_NOT_ALLOWED";

export interface DriverApplicant {
  userId: string;
  user: Record<string, unknown>;
}

const APPLICANT_REQUEST_KEY = "driverApplicant";

export function ticketInvalid(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    message: "가입 신청 확인 시간이 지났습니다. 카카오로 다시 로그인해 주세요.",
    error: "Unauthorized",
    code: DRIVER_APPLICATION_TICKET_INVALID,
  });
}

/** 가입 신청을 읽고 쓸 수 없는 계정 상태를 HTTP 거절로 바꾼다. 신청 가능(pending)이면 null. */
export function applicantStateRejection(
  state: DriverApplicantState,
): UnauthorizedException | ForbiddenException | null {
  switch (state) {
    case "pending":
      return null;
    case "missing":
    case "withdrawn":
      return ticketInvalid();
    case "approved":
      return new ForbiddenException({
        statusCode: 403,
        message: "이미 승인된 기사입니다. 다시 로그인해 주세요.",
        error: "Forbidden",
        code: DRIVER_ALREADY_APPROVED,
      });
    case "not_driver":
    case "suspended":
      return new ForbiddenException({
        statusCode: 403,
        message: "가입 신청을 할 수 없는 계정입니다.",
        error: "Forbidden",
        code: DRIVER_APPLICATION_NOT_ALLOWED,
      });
  }
}

/**
 * 기사 가입 신청 티켓(`Authorization: Bearer <티켓>`)을 확인하고, 요청마다 사용자 문서를 다시 읽어
 * 승인 전·정지 아님·탈퇴 아님인 기사 계정만 통과시킨다. 통과하면 요청에 신청자(id·문서)를 싣는다.
 * 일반 access token·refresh token은 종류(typ)·수신자(aud)가 달라 통과하지 못한다.
 */
@Injectable()
export class DriverApplicationTicketGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly firestore: FirestoreService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, any>>();
    const userId = verifyDriverApplicationTicket(
      this.jwt,
      this.config.get<string>("JWT_SECRET"),
      bearerFromHeaders(request.headers),
    );
    if (!userId) throw ticketInvalid();

    const snap = await this.firestore.doc(`users/${userId}`).get();
    const user = snap.exists
      ? (snap.data() as Record<string, unknown>)
      : undefined;
    const rejection = applicantStateRejection(driverApplicantState(user));
    if (rejection) throw rejection;

    const applicant: DriverApplicant = { userId, user: user! };
    request[APPLICANT_REQUEST_KEY] = applicant;
    return true;
  }
}

export const CurrentDriverApplicant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): DriverApplicant =>
    ctx.switchToHttp().getRequest<Record<string, any>>()[
      APPLICANT_REQUEST_KEY
    ] as DriverApplicant,
);
