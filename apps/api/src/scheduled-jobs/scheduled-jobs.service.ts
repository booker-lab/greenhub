import { Injectable, NotFoundException } from '@nestjs/common';
import { EngagementService } from '../engagement/engagement.service';
import { MarketPricesService } from '../market-prices/market-prices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OpsDigestService } from '../ops-alerts/ops-digest.service';
import { PaymentsService } from '../payments/payments.service';
import { RetentionService } from '../retention/retention.service';
import { SettlementsService } from '../settlements/settlements.service';

/**
 * 서버 안 정기 작업(@Cron)을 외부 예약 호출로도 돌릴 수 있게 이름으로 묶는다.
 * 작업 본문과 중복 실행 방어(lease·트랜잭션 재확인)는 각 서비스가 그대로 소유한다.
 * 예약 시각은 docs/specs/ops/api-cloud-run-runbook.md의 Cloud Scheduler 목록이 @Cron과 같게 맞춘다.
 */
@Injectable()
export class ScheduledJobsService {
  private readonly jobs: Readonly<Record<string, () => Promise<unknown>>>;

  constructor(
    payments: PaymentsService,
    notifications: NotificationsService,
    settlements: SettlementsService,
    retention: RetentionService,
    engagement: EngagementService,
    opsDigest: OpsDigestService,
    marketPrices: MarketPricesService,
  ) {
    this.jobs = {
      'payments-cleanup-pending-orders': () => payments.cleanupPendingOrders(),
      'group-buy-deadlines': () => notifications.processGroupBuyDeadlines(),
      'group-buy-deadline-soon': () => notifications.notifyDeadlineSoon(),
      'settlements-confirm-due': () => settlements.confirmDueSettlements(),
      'retention-purge': () => retention.runScheduledPurge(),
      'partner-inquiry-purge': () => engagement.runScheduledPartnerInquiryPurge(),
      'ops-daily-digest': () => opsDigest.sendDailyDigest(),
      'market-prices-ingest': () => marketPrices.runScheduledIngest(),
    };
  }

  jobNames(): string[] {
    return Object.keys(this.jobs);
  }

  async run(jobName: string): Promise<void> {
    const job = Object.hasOwn(this.jobs, jobName) ? this.jobs[jobName] : undefined;
    if (!job) throw new NotFoundException();
    await job();
  }
}
