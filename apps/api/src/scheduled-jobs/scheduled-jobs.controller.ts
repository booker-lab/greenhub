import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { SchedulerInvokerGuard } from './scheduler-invoker.guard';

// Cloud Scheduler 전용. 작업이 끝난 뒤 응답하므로, 요청이 없을 때 CPU를 쓰지 않는 Cloud Run에서도 끝까지 돈다.
@Controller('internal/scheduled-jobs')
@UseGuards(SchedulerInvokerGuard)
export class ScheduledJobsController {
  constructor(private readonly jobs: ScheduledJobsService) {}

  @Post(':jobName')
  @HttpCode(204)
  async run(@Param('jobName') jobName: string): Promise<void> {
    await this.jobs.run(jobName);
  }
}
