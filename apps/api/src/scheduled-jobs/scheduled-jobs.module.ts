import { Module } from '@nestjs/common';
import { EngagementModule } from '../engagement/engagement.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { RetentionModule } from '../retention/retention.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { ScheduledJobsController } from './scheduled-jobs.controller';
import { ScheduledJobsService } from './scheduled-jobs.service';
import {
  createGoogleIdTokenVerifier,
  SCHEDULER_ID_TOKEN_VERIFIER,
  SchedulerInvokerGuard,
} from './scheduler-invoker.guard';

@Module({
  imports: [
    PaymentsModule,
    NotificationsModule,
    SettlementsModule,
    RetentionModule,
    EngagementModule,
  ],
  controllers: [ScheduledJobsController],
  providers: [
    ScheduledJobsService,
    SchedulerInvokerGuard,
    { provide: SCHEDULER_ID_TOKEN_VERIFIER, useFactory: createGoogleIdTokenVerifier },
  ],
})
export class ScheduledJobsModule {}
