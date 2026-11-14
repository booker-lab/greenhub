import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  CurrentDriverApplicant,
  type DriverApplicant,
  DriverApplicationEnabledGuard,
  DriverApplicationTicketGuard,
} from "./driver-application-ticket.guard";
import { DriverApplicationsService } from "./driver-applications.service";
import { UpsertDriverApplicationDto } from "./dto/upsert-driver-application.dto";

// 신청 저장은 1분 10회. 기사 앱 서버(Vercel)가 대신 호출해 여러 기사가 같은 서버 IP를 나눠 쓰므로,
// ClientThrottlerGuard가 서명 검증된 신청 티켓의 사용자(sub) 단위로 센다(티켓이 없거나 틀리면 IP 단위).
export const DRIVER_APPLICATION_WRITE_THROTTLE = {
  default: { limit: 10, ttl: 60000 },
};

// 승인 전 기사의 가입 신청. 세션(access token) 대신 카카오 로그인 거절 응답의 신청 티켓으로만 들어온다.
// 기능 스위치(DRIVER_APPLICATION_ENABLED)가 꺼져 있으면 티켓보다 먼저 403으로 막는다.
@Controller("driver-applications")
@UseGuards(DriverApplicationEnabledGuard, DriverApplicationTicketGuard)
export class DriverApplicationsController {
  constructor(private readonly applications: DriverApplicationsService) {}

  @Get("me")
  getMine(@CurrentDriverApplicant() applicant: DriverApplicant) {
    return this.applications.getMine(applicant);
  }

  @Put("me")
  @Throttle(DRIVER_APPLICATION_WRITE_THROTTLE)
  upsertMine(
    @CurrentDriverApplicant() applicant: DriverApplicant,
    @Body() dto: UpsertDriverApplicationDto,
  ) {
    return this.applications.upsertMine(applicant.userId, dto);
  }
}
