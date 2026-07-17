import { Module } from '@nestjs/common';
import { OperationIssueWriterService } from './operation-issue-writer.service';

@Module({
  providers: [OperationIssueWriterService],
  exports: [OperationIssueWriterService],
})
export class OperationIssuesModule {}
