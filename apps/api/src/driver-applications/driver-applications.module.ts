import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import {
  DriverApplicationEnabledGuard,
  DriverApplicationTicketGuard,
} from "./driver-application-ticket.guard";
import { DriverApplicationsController } from "./driver-applications.controller";
import { DriverApplicationsService } from "./driver-applications.service";

// 승인 전 기사의 가입 신청(GET·PUT /driver-applications/me). 신청 티켓 검증에 AuthModule의 JwtService를 쓴다.
@Module({
  imports: [AuthModule],
  controllers: [DriverApplicationsController],
  providers: [
    DriverApplicationsService,
    DriverApplicationEnabledGuard,
    DriverApplicationTicketGuard,
  ],
})
export class DriverApplicationsModule {}
